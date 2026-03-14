"""
SDK Session Manager -- proxy to the SDK worker process.

Delegates all SDK operations to the worker process via WorkerClient.
The worker manages ClaudeSDKClient instances in a separate process
that survives Flask restarts.
"""

import logging
import threading
from typing import Callable, Optional

from backend.worker_client import WorkerClient

logger = logging.getLogger(__name__)


class SessionManager:
    """Proxy to the SDK worker process.

    Routes queries and events between Flask's SocketIO handlers
    and the long-lived worker process. All SDK subprocess management
    happens in the worker — this class just forwards messages.
    """

    def __init__(self) -> None:
        self._client = WorkerClient()
        self._lock = threading.Lock()
        # Per-session callbacks: session_id -> {on_text, on_tool_event, on_complete, on_error}
        self._callbacks: dict[str, dict[str, Callable]] = {}
        # Track which sessions have active queries
        self._active_sessions: set[str] = set()
        # Track whether we've received at least one session status (to detect lost sessions)
        self._has_received_status: bool = False
        # Callback to notify when worker reconnects with active sessions
        self.on_session_reconnect: Optional[Callable[[str], None]] = None
        # Callback to notify when a session's query was lost (worker restart)
        self.on_session_lost: Optional[Callable[[str], None]] = None
        # Pending questions: session_id -> question data
        self._pending_questions: dict[str, dict] = {}

        # Wire up worker client event handlers
        self._client.on_text_delta = self._handle_text_delta
        self._client.on_tool_event = self._handle_tool_event
        self._client.on_response_complete = self._handle_response_complete
        self._client.on_error = self._handle_error
        self._client.on_session_status = self._handle_session_status
        self._client.on_user_question = self._handle_user_question

        # Connect to worker
        self._client.connect()

    def submit_query(
        self,
        session_id: str,
        prompt: str,
        workspace: str,
        on_text: Callable[[str], None],
        on_tool_event: Callable[[dict], None],
        on_complete: Callable[[dict], None],
        on_error: Callable[[str], None],
        model: Optional[str] = None,
        image_ids: Optional[list[str]] = None,
        on_user_question: Optional[Callable[[dict], None]] = None,
    ):
        """Submit a query to the SDK worker."""
        # Register callbacks for this session
        with self._lock:
            cbs = {
                "on_text": on_text,
                "on_tool_event": on_tool_event,
                "on_complete": on_complete,
                "on_error": on_error,
            }
            if on_user_question:
                cbs["on_user_question"] = on_user_question
            self._callbacks[session_id] = cbs
            self._active_sessions.add(session_id)

        self._client.submit_query(session_id, prompt, workspace, model, image_ids)

    def register_streaming_callbacks(
        self,
        session_id: str,
        on_text: Callable[[str], None],
        on_tool_event: Callable[[dict], None],
        on_complete: Callable[[dict], None],
        on_error: Callable[[str], None],
        on_user_question: Optional[Callable[[dict], None]] = None,
    ):
        """Register callbacks for an already-active session (e.g., after Flask restart)."""
        with self._lock:
            cbs = {
                "on_text": on_text,
                "on_tool_event": on_tool_event,
                "on_complete": on_complete,
                "on_error": on_error,
            }
            if on_user_question:
                cbs["on_user_question"] = on_user_question
            self._callbacks[session_id] = cbs
            self._active_sessions.add(session_id)

    def cancel_query(self, session_id: str) -> None:
        """Cancel the active query for a session."""
        self._client.cancel_query(session_id)

    def is_active(self, session_id: str) -> bool:
        """Check if a session has an active query."""
        with self._lock:
            return session_id in self._active_sessions

    def get_active_sessions(self) -> list[str]:
        """Return list of session IDs with active queries."""
        with self._lock:
            return list(self._active_sessions)

    def disconnect_session(self, session_id: str) -> None:
        """Disconnect a session's SDK client in the worker."""
        with self._lock:
            self._callbacks.pop(session_id, None)
            self._active_sessions.discard(session_id)
        self._client.disconnect_session(session_id)

    def send_question_response(self, session_id: str, response: str) -> None:
        """Forward user's question response to the worker."""
        self._client.send_question_response(session_id, response)

    def shutdown(self) -> None:
        """Disconnect from the worker (does NOT shut down the worker)."""
        self._client.disconnect()

    @property
    def worker_connected(self) -> bool:
        """Whether we're connected to the worker process."""
        return self._client.connected

    # --- Event handlers from worker ---

    def _handle_text_delta(self, session_id: str, text: str) -> None:
        with self._lock:
            cbs = self._callbacks.get(session_id)
        if cbs and cbs.get("on_text"):
            try:
                cbs["on_text"](text)
            except Exception as e:
                logger.error(f"Error in on_text callback for {session_id}: {e}")

    def _handle_tool_event(self, session_id: str, event: dict) -> None:
        with self._lock:
            cbs = self._callbacks.get(session_id)
        if cbs and cbs.get("on_tool_event"):
            try:
                cbs["on_tool_event"](event)
            except Exception as e:
                logger.error(f"Error in on_tool_event callback for {session_id}: {e}")

    def _handle_response_complete(self, session_id: str, data: dict) -> None:
        with self._lock:
            cbs = self._callbacks.get(session_id)
            # Only remove from active if this is a final completion (has sdk_session_id in data = ResultMessage)
            if data.get("sdk_session_id"):
                self._active_sessions.discard(session_id)
        if cbs and cbs.get("on_complete"):
            try:
                cbs["on_complete"](data)
            except Exception as e:
                logger.error(f"Error in on_complete callback for {session_id}: {e}")

    def _handle_error(self, session_id: str, message: str) -> None:
        with self._lock:
            cbs = self._callbacks.get(session_id)
            self._active_sessions.discard(session_id)
        if cbs and cbs.get("on_error"):
            try:
                cbs["on_error"](message)
            except Exception as e:
                logger.error(f"Error in on_error callback for {session_id}: {e}")

    def _handle_session_status(self, sessions: list) -> None:
        """Handle session status from worker (sent on reconnect)."""
        with self._lock:
            new_active = {
                s["session_id"] for s in sessions if s.get("query_active")
            }

            # Detect sessions that disappeared (worker restarted)
            lost_sessions = set()
            if self._has_received_status:
                lost_sessions = self._active_sessions - new_active

            self._active_sessions = new_active
            self._has_received_status = True

            # Extract pending question data from each session
            self._pending_questions = {}
            for s in sessions:
                pq = s.get("pending_question")
                if pq:
                    self._pending_questions[s["session_id"]] = pq

        logger.info(f"Worker session status: {len(sessions)} sessions, {len(new_active)} active")

        if lost_sessions:
            logger.warning(f"Detected {len(lost_sessions)} lost sessions after worker restart: {lost_sessions}")

        # Notify about lost sessions
        if self.on_session_lost:
            for session_id in lost_sessions:
                try:
                    self.on_session_lost(session_id)
                except Exception as e:
                    logger.error(f"Error in on_session_lost for {session_id}: {e}")

        # Auto-register callbacks for active sessions
        if self.on_session_reconnect:
            for session_id in list(new_active):
                try:
                    self.on_session_reconnect(session_id)
                except Exception as e:
                    logger.error(f"Error in on_session_reconnect for {session_id}: {e}")

    def _handle_user_question(self, session_id: str, data: dict) -> None:
        """Handle user question from worker - forward to SocketIO."""
        with self._lock:
            cbs = self._callbacks.get(session_id)
        if cbs and cbs.get("on_user_question"):
            try:
                cbs["on_user_question"](data)
            except Exception as e:
                logger.error(f"Error in on_user_question callback for {session_id}: {e}")

    def get_pending_question(self, session_id: str) -> Optional[dict]:
        """Return pending question data for a session, if any."""
        with self._lock:
            return self._pending_questions.get(session_id)
