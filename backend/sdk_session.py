"""
SDK Session Manager -- one streaming session per user.

Calls claude_code_sdk.query() and streams events back via callbacks.
Each user gets one active query at a time. New messages wait for the
previous to complete or cancel it.

Design principles:
    - Everything streams through callbacks (on_text, on_tool_event, on_complete, on_error)
    - SessionManager runs its own asyncio loop in a background thread so callers
      (e.g., Flask/SocketIO handlers) don't need to be async
    - Cancellation is cooperative via asyncio.Event checked between SDK messages
    - Thread-safety enforced via threading.Lock on shared _active dict
"""

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional

from claude_code_sdk import ClaudeCodeOptions, Message as SDKMessage, query

logger = logging.getLogger(__name__)


@dataclass
class ActiveSession:
    """Tracks one active SDK query for cancellation and introspection."""

    session_id: str
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())


class SessionManager:
    """Manages Claude Code SDK sessions, one per user.

    Runs a dedicated asyncio event loop in a daemon thread. Sync callers
    submit queries via ``submit_query()`` which schedules the coroutine
    on that loop and returns a ``concurrent.futures.Future``.

    Lifecycle:
        1. ``submit_query(session_id, ...)`` -- cancel any prior query for
           this session, then schedule a new streaming query.
        2. SDK events arrive via ``async for message in query(...)``.
        3. Each event is dispatched to the appropriate callback
           (on_text, on_tool_event, on_complete, on_error).
        4. On cancellation, completion, or error the session is removed
           from ``_active``.
    """

    def __init__(self) -> None:
        self._active: dict[str, ActiveSession] = {}  # session_id -> ActiveSession
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._start_loop()

    # ------------------------------------------------------------------
    # Event loop management
    # ------------------------------------------------------------------

    def _start_loop(self) -> None:
        """Start dedicated asyncio event loop in a background daemon thread."""
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop,
            daemon=True,
            name="sdk-session-loop",
        )
        self._thread.start()

    def _run_loop(self) -> None:
        """Target for the background thread -- run the loop forever."""
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def submit_query(
        self,
        session_id: str,
        prompt: str,
        workspace: str,
        on_text: Callable[[str], None],
        on_tool_event: Callable[[dict], None],
        on_complete: Callable[[dict], None],
        on_error: Callable[[str], None],
    ):
        """Submit a query to the SDK. Runs async in the background loop.

        If a query is already active for ``session_id``, it is cancelled
        before the new one starts.

        Args:
            session_id: Unique identifier for the user/session.
            prompt: The user message to send to Claude.
            workspace: Working directory for the SDK (cwd).
            on_text: Called with each text chunk as it streams in.
            on_tool_event: Called with tool start/complete event dicts.
            on_complete: Called once with summary dict when query finishes.
            on_error: Called with error string if query fails.

        Returns:
            A ``concurrent.futures.Future`` that resolves when the query
            coroutine completes.
        """
        # Cancel any existing query for this session
        self.cancel_query(session_id)

        future = asyncio.run_coroutine_threadsafe(
            self._stream_query(
                session_id=session_id,
                prompt=prompt,
                workspace=workspace,
                on_text=on_text,
                on_tool_event=on_tool_event,
                on_complete=on_complete,
                on_error=on_error,
            ),
            self._loop,
        )
        return future

    def cancel_query(self, session_id: str) -> None:
        """Cancel an active query for a session.

        Sets the cancel_event which is checked between SDK messages
        in ``_stream_query``. The query coroutine will break out of
        the message loop on the next iteration.
        """
        with self._lock:
            active = self._active.get(session_id)
            if active:
                active.cancel_event.set()
                logger.info(f"Cancelling query for session {session_id}")

    def is_active(self, session_id: str) -> bool:
        """Check if a session has an active query."""
        with self._lock:
            return session_id in self._active

    def get_active_sessions(self) -> list[str]:
        """Return list of active session IDs."""
        with self._lock:
            return list(self._active.keys())

    def shutdown(self) -> None:
        """Shutdown the session manager gracefully.

        Cancels all active sessions, stops the event loop, and joins
        the background thread.
        """
        with self._lock:
            for active in self._active.values():
                active.cancel_event.set()

        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread:
            self._thread.join(timeout=5)

    # ------------------------------------------------------------------
    # Internal streaming logic
    # ------------------------------------------------------------------

    async def _stream_query(
        self,
        session_id: str,
        prompt: str,
        workspace: str,
        on_text: Callable[[str], None],
        on_tool_event: Callable[[dict], None],
        on_complete: Callable[[dict], None],
        on_error: Callable[[str], None],
    ) -> None:
        """Execute SDK query and stream results via callbacks.

        This coroutine runs on the dedicated event loop. It iterates
        over SDK messages and dispatches each to the appropriate callback.

        Message types handled:
            - ``assistant``: Contains text blocks and tool_use blocks.
              Text blocks are forwarded via ``on_text``, tool_use blocks
              via ``on_tool_event``.
            - ``result``: Terminal message with session metadata. Forwarded
              via ``on_complete``.

        On exception the ``on_error`` callback receives the error string.
        The session is always removed from ``_active`` in the finally block.
        """
        active = ActiveSession(session_id=session_id)
        with self._lock:
            self._active[session_id] = active

        try:
            options = ClaudeCodeOptions(
                max_turns=50,
            )

            result_text: list[str] = []

            async for message in query(
                prompt=prompt,
                options=options,
            ):
                # Check cancellation between messages
                if active.cancel_event.is_set():
                    logger.info(f"Query cancelled for session {session_id}")
                    break

                # Dispatch based on message type
                if message.type == "assistant":
                    self._handle_assistant_message(
                        message, session_id, result_text, on_text, on_tool_event
                    )

                elif message.type == "result":
                    on_complete({
                        "text": "".join(result_text),
                        "session_id": getattr(message, "session_id", None),
                        "cost": getattr(message, "cost_usd", None),
                        "duration_ms": getattr(message, "duration_ms", None),
                        "input_tokens": getattr(message, "input_tokens", None),
                        "output_tokens": getattr(message, "output_tokens", None),
                    })

        except Exception as e:
            logger.error(f"SDK query error for session {session_id}: {e}", exc_info=True)
            on_error(str(e))

        finally:
            with self._lock:
                self._active.pop(session_id, None)

    def _handle_assistant_message(
        self,
        message,
        session_id: str,
        result_text: list[str],
        on_text: Callable[[str], None],
        on_tool_event: Callable[[dict], None],
    ) -> None:
        """Process an assistant message, dispatching text and tool events.

        Args:
            message: The SDK assistant message with content blocks.
            session_id: Session identifier for event metadata.
            result_text: Accumulator list for text chunks.
            on_text: Callback for text content.
            on_tool_event: Callback for tool use events.
        """
        for block in message.content:
            if block.type == "text":
                result_text.append(block.text)
                on_text(block.text)
            elif block.type == "tool_use":
                on_tool_event({
                    "type": "tool_start",
                    "tool_name": block.name,
                    "tool_use_id": block.id,
                    "parameters": block.input if hasattr(block, "input") else {},
                    "timestamp": datetime.now().isoformat(),
                    "session_id": session_id,
                })
