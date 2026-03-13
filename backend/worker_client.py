"""
Worker Client -- Flask-side client for communicating with the SDK worker process.

Connects to the worker over a Unix domain socket, sends commands,
and dispatches incoming events via registered callbacks.
"""

import json
import logging
import socket
import threading
import time
from typing import Callable, Optional

from backend.config import WORKER_SOCKET_PATH

logger = logging.getLogger(__name__)


def _encode_message(msg: dict) -> bytes:
    """Encode a message dict to JSON-line bytes."""
    return json.dumps(msg, default=str).encode("utf-8") + b"\n"


def _decode_message(line: bytes) -> dict:
    """Decode a JSON-line to a message dict."""
    return json.loads(line.decode("utf-8").strip())


class WorkerClient:
    """Client for communicating with the SDK worker process.

    Usage:
        client = WorkerClient()
        client.on_text_delta = lambda session_id, text: ...
        client.on_tool_event = lambda session_id, event: ...
        client.on_response_complete = lambda session_id, data: ...
        client.on_error = lambda session_id, message: ...
        client.on_session_status = lambda sessions: ...
        client.connect()

        client.submit_query(session_id, prompt, workspace, model)
        client.cancel_query(session_id)
        client.disconnect_session(session_id)
    """

    def __init__(self, socket_path: str = WORKER_SOCKET_PATH):
        self._socket_path = socket_path
        self._sock: Optional[socket.socket] = None
        self._lock = threading.Lock()
        self._reader_thread: Optional[threading.Thread] = None
        self._running = False
        self._connected = False
        self._buffer = b""

        # Event callbacks (set by the consumer, e.g. SessionManager)
        self.on_text_delta: Optional[Callable[[str, str], None]] = None  # (session_id, text)
        self.on_tool_event: Optional[Callable[[str, dict], None]] = None  # (session_id, event)
        self.on_response_complete: Optional[Callable[[str, dict], None]] = None  # (session_id, data)
        self.on_error: Optional[Callable[[str, str], None]] = None  # (session_id, message)
        self.on_session_status: Optional[Callable[[list], None]] = None  # (sessions)

    @property
    def connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        """Start the client. Connects to worker and starts reader thread.

        If worker is not available, retries in background.
        """
        self._running = True
        self._reader_thread = threading.Thread(
            target=self._reader_loop, daemon=True, name="worker-client-reader"
        )
        self._reader_thread.start()

    def disconnect(self) -> None:
        """Stop the client and close the connection."""
        self._running = False
        self._close_socket()
        if self._reader_thread:
            self._reader_thread.join(timeout=5)

    def submit_query(self, session_id: str, prompt: str, workspace: str, model: Optional[str] = None) -> None:
        """Send a query to the worker."""
        self._send({
            "type": "submit_query",
            "session_id": session_id,
            "prompt": prompt,
            "workspace": workspace,
            "model": model,
        })

    def cancel_query(self, session_id: str) -> None:
        """Cancel an active query."""
        self._send({
            "type": "cancel_query",
            "session_id": session_id,
        })

    def disconnect_session(self, session_id: str) -> None:
        """Disconnect a session's SDK client."""
        self._send({
            "type": "disconnect_session",
            "session_id": session_id,
        })

    def list_sessions(self) -> None:
        """Request list of active sessions."""
        self._send({"type": "list_sessions"})

    def ping(self) -> None:
        """Send keepalive ping."""
        self._send({"type": "ping"})

    def _send(self, msg: dict) -> None:
        """Send a message to the worker. Thread-safe."""
        with self._lock:
            if not self._sock or not self._connected:
                logger.warning(f"Cannot send {msg.get('type')}: not connected to worker")
                return
            try:
                self._sock.sendall(_encode_message(msg))
            except (BrokenPipeError, OSError) as e:
                logger.error(f"Failed to send to worker: {e}")
                self._connected = False

    def _connect_socket(self) -> bool:
        """Try to connect to the worker socket. Returns True on success."""
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(self._socket_path)
            sock.settimeout(1.0)  # for reads in the reader loop
            with self._lock:
                self._sock = sock
                self._connected = True
                self._buffer = b""
            logger.info(f"Connected to SDK worker at {self._socket_path}")
            return True
        except (ConnectionRefusedError, FileNotFoundError, OSError) as e:
            logger.debug(f"Cannot connect to worker: {e}")
            return False

    def _close_socket(self) -> None:
        """Close the socket connection."""
        with self._lock:
            self._connected = False
            if self._sock:
                try:
                    self._sock.close()
                except OSError:
                    pass
                self._sock = None

    def _reader_loop(self) -> None:
        """Background thread: connect to worker, read events, dispatch callbacks.

        Reconnects automatically if connection is lost.
        """
        while self._running:
            if not self._connected:
                if not self._connect_socket():
                    time.sleep(2)
                    continue

            try:
                # Read from socket
                with self._lock:
                    sock = self._sock
                if not sock:
                    continue

                try:
                    data = sock.recv(65536)
                except socket.timeout:
                    continue
                except OSError:
                    self._close_socket()
                    continue

                if not data:
                    # Connection closed
                    logger.info("Worker connection closed")
                    self._close_socket()
                    continue

                self._buffer += data

                # Process complete lines
                while b"\n" in self._buffer:
                    line, self._buffer = self._buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = _decode_message(line)
                        self._dispatch(msg)
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.warning(f"Invalid message from worker: {e}")

            except Exception as e:
                logger.error(f"Worker reader error: {e}")
                self._close_socket()
                time.sleep(1)

    def _dispatch(self, msg: dict) -> None:
        """Dispatch a worker event to the appropriate callback."""
        msg_type = msg.get("type")
        session_id = msg.get("session_id", "")

        try:
            if msg_type == "text_delta" and self.on_text_delta:
                self.on_text_delta(session_id, msg.get("text", ""))
            elif msg_type == "tool_event" and self.on_tool_event:
                self.on_tool_event(session_id, msg.get("event", {}))
            elif msg_type == "response_complete" and self.on_response_complete:
                self.on_response_complete(session_id, msg)
            elif msg_type == "error" and self.on_error:
                self.on_error(session_id, msg.get("message", "Unknown error"))
            elif msg_type == "session_status" and self.on_session_status:
                self.on_session_status(msg.get("sessions", []))
            elif msg_type == "pong":
                logger.debug("Received pong from worker")
            elif msg_type == "query_ack":
                logger.debug(f"Query acknowledged for session {session_id}")
            else:
                logger.debug(f"Unhandled worker message type: {msg_type}")
        except Exception as e:
            logger.error(f"Error dispatching worker event {msg_type}: {e}")
