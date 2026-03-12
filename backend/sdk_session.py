"""
SDK Session Manager -- one streaming session per user.

Uses ClaudeSDKClient (persistent subprocess) instead of standalone query().
Each user gets one persistent client that remains alive across messages,
eliminating the ~12s subprocess spawn overhead on subsequent queries.
"""

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional

from claude_code_sdk import (
    AssistantMessage,
    ClaudeCodeOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
)
from claude_code_sdk.types import HookMatcher, HookContext, HookJSONOutput
from claude_code_sdk._errors import MessageParseError
from claude_code_sdk._internal.message_parser import parse_message as sdk_parse_message

from backend.database import get_last_sdk_session_id

# These may not be exported from top-level
try:
    from claude_code_sdk import StreamEvent, UserMessage
except ImportError:
    from claude_code_sdk.types import StreamEvent, UserMessage

logger = logging.getLogger(__name__)


@dataclass
class ActiveSession:
    """Tracks one active SDK query for cancellation and introspection.

    Kept for backward compatibility with existing tests.
    """
    session_id: str
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class PersistentSession:
    """A persistent SDK client for one browser session.

    Holds the ClaudeSDKClient instance and tracks query state.
    The client subprocess remains alive across multiple messages,
    eliminating spawn overhead.
    """
    session_id: str
    client: Any  # ClaudeSDKClient instance
    workspace: Optional[str] = None  # cwd the client was spawned with
    model: Optional[str] = None  # model the client was spawned with
    sdk_session_id: Optional[str] = None  # captured from ResultMessage
    query_active: bool = False
    cancel_requested: bool = False
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    last_activity: float = field(default_factory=time.monotonic)
    tool_event_callback: Optional[Callable[[dict], None]] = None  # latest on_tool_event callback


class SessionManager:
    """Manages Claude Code SDK sessions, one per user.

    Each browser session gets a persistent ClaudeSDKClient that remains
    alive across messages. The client is created on first message and
    torn down on disconnect.
    """

    def __init__(self) -> None:
        self._active: dict[str, ActiveSession] = {}  # kept for backward compat
        self._sessions: dict[str, PersistentSession] = {}  # persistent clients
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._start_loop()

    def _start_loop(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name="sdk-session-loop",
        )
        self._thread.start()

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

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
    ):
        self.cancel_query(session_id)
        return asyncio.run_coroutine_threadsafe(
            self._stream_query(
                session_id=session_id,
                prompt=prompt,
                workspace=workspace,
                model=model,
                on_text=on_text,
                on_tool_event=on_tool_event,
                on_complete=on_complete,
                on_error=on_error,
            ),
            self._loop,
        )

    def cancel_query(self, session_id: str) -> None:
        """Cancel the active query for a session using client.interrupt()."""
        with self._lock:
            # Backward compat: also set cancel_event on ActiveSession
            active = self._active.get(session_id)
            if active:
                active.cancel_event.set()

            # New: mark persistent session for cancellation
            ps = self._sessions.get(session_id)
            if ps and ps.query_active:
                ps.cancel_requested = True
                logger.info(f"Cancelling query for session {session_id}")

    def is_active(self, session_id: str) -> bool:
        """Check if a session has an active query."""
        with self._lock:
            # Check new persistent session state first
            ps = self._sessions.get(session_id)
            if ps:
                return ps.query_active
            # Fallback to old ActiveSession for backward compat
            return session_id in self._active

    def get_active_sessions(self) -> list[str]:
        """Return list of session IDs with active queries."""
        with self._lock:
            # Check persistent sessions first
            active_from_persistent = [
                sid for sid, ps in self._sessions.items() if ps.query_active
            ]
            if active_from_persistent:
                return active_from_persistent
            # Fallback to old _active dict for backward compat
            return list(self._active.keys())

    def disconnect_session(self, session_id: str) -> None:
        """Disconnect a persistent session (call on WebSocket disconnect).

        This tears down the subprocess to free resources.
        """
        if self._loop:
            asyncio.run_coroutine_threadsafe(
                self._disconnect_session(session_id), self._loop
            )

    def shutdown(self) -> None:
        """Shutdown the manager, disconnecting all clients and stopping the loop."""
        with self._lock:
            # Set cancel flags on all sessions
            for active in self._active.values():
                active.cancel_event.set()
            for ps in self._sessions.values():
                ps.cancel_requested = True

        # Disconnect all persistent clients and wait for completion
        if self._loop and self._sessions:
            futures = []
            for sid in list(self._sessions.keys()):
                future = asyncio.run_coroutine_threadsafe(
                    self._disconnect_session(sid), self._loop
                )
                futures.append(future)

            # Wait for all disconnects to complete (with timeout)
            for future in futures:
                try:
                    future.result(timeout=2)
                except Exception as exc:
                    logger.warning(f"Error during shutdown disconnect: {exc}")

        # Stop the loop
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)

        if self._thread:
            self._thread.join(timeout=5)

    # ------------------------------------------------------------------
    # Persistent client management
    # ------------------------------------------------------------------

    async def _get_or_create_client(
        self,
        session_id: str,
        workspace: str,
        model: Optional[str] = None,
    ) -> PersistentSession:
        """Get or create a persistent ClaudeSDKClient for this session.

        If the session already has a connected client, reuse it.
        Otherwise, create a new client, connect it, and store it.

        Note: The on_tool_event callback is updated separately in _stream_query
        via ps.tool_event_callback before each query.
        """
        with self._lock:
            ps = self._sessions.get(session_id)

        if ps and ps.client:
            # If workspace or model changed, tear down old client and create fresh one
            if (ps.workspace and ps.workspace != workspace) or (model and ps.model and ps.model != model):
                logger.info(f"Workspace or model changed for session {session_id}: workspace={ps.workspace}->{workspace}, model={ps.model}->{model}")
                await self._disconnect_session(session_id)
            else:
                # Reuse existing connected client
                logger.debug(f"Reusing persistent client for session {session_id}")
                return ps

        # Create new client
        logger.info(f"Creating new persistent client for session {session_id}")

        clean_env = {
            k: v for k, v in os.environ.items()
            if k != "CLAUDECODE"
        }

        # Create a new PersistentSession instance first (needed for hooks)
        ps = PersistentSession(
            session_id=session_id,
            client=None,  # will be set below
            workspace=workspace,
            model=model,
        )

        # Build hooks that reference ps (they'll read ps.tool_event_callback)
        hooks = self._build_hooks(session_id, ps)

        # Auto-approve callback for tool permission requests
        async def auto_approve_tool(tool_name, tool_input, context):
            return PermissionResultAllow()

        # Look up previous SDK session ID for conversation resumption
        resume_id = get_last_sdk_session_id(session_id)
        if resume_id:
            logger.info(f"Resuming SDK session {resume_id} for {session_id}")

        options = ClaudeCodeOptions(
            max_turns=50,
            cwd=workspace,
            permission_mode="bypassPermissions",
            env=clean_env,
            hooks=hooks,
            can_use_tool=auto_approve_tool,
            model=model or "sonnet",
            resume=resume_id or "",
        )

        client = ClaudeSDKClient(options)
        await client.connect()  # spawns subprocess

        ps.client = client

        with self._lock:
            self._sessions[session_id] = ps

        return ps

    async def _disconnect_session(self, session_id: str) -> None:
        """Disconnect and remove a persistent session."""
        with self._lock:
            ps = self._sessions.pop(session_id, None)

        if ps and ps.client:
            try:
                logger.info(f"Disconnecting persistent client for session {session_id}")
                await ps.client.disconnect()
            except Exception as exc:
                logger.error(f"Error disconnecting client for {session_id}: {exc}")

    # ------------------------------------------------------------------
    # Hook builders
    # ------------------------------------------------------------------

    def _build_hooks(
        self,
        session_id: str,
        ps: PersistentSession,
    ) -> dict:
        """Build SDK hook callbacks that forward tool events to the frontend.

        The hooks close over the PersistentSession instance and call
        ps.tool_event_callback, which is updated on each query to point to
        the latest on_tool_event callback. This ensures hooks always use the
        current callback even when the client is reused.
        """
        tool_timers: dict[str, float] = {}
        agent_stack: list[str] = []  # stack of agent tool_use_ids

        async def pre_tool_use(
            tool_input: dict[str, Any],
            tool_name: str | None,
            context: HookContext,
        ) -> HookJSONOutput:
            tool_use_id = tool_input.get("tool_use_id", f"tu_{time.monotonic()}")
            tool_timers[tool_use_id] = time.monotonic()

            is_agent = tool_name in ("Agent", "Task")
            parent_id = agent_stack[-1] if agent_stack else None

            # Call the latest tool_event_callback from ps
            if ps.tool_event_callback:
                if is_agent:
                    agent_stack.append(tool_use_id)
                    ps.tool_event_callback({
                        "type": "agent_start",
                        "tool_name": tool_name or "Agent",
                        "tool_use_id": tool_use_id,
                        "parent_agent_id": parent_id,
                        "agent_type": tool_input.get("subagent_type", "agent"),
                        "description": tool_input.get("description", tool_input.get("prompt", "")[:100]),
                        "timestamp": datetime.now().isoformat(),
                        "session_id": session_id,
                    })
                else:
                    ps.tool_event_callback({
                        "type": "tool_start",
                        "tool_name": tool_name or "unknown",
                        "tool_use_id": tool_use_id,
                        "parent_agent_id": parent_id,
                        "parameters": _safe_params(tool_input),
                        "timestamp": datetime.now().isoformat(),
                        "session_id": session_id,
                    })

            return HookJSONOutput()

        async def post_tool_use(
            tool_input: dict[str, Any],
            tool_name: str | None,
            context: HookContext,
        ) -> HookJSONOutput:
            tool_use_id = tool_input.get("tool_use_id", "")
            start = tool_timers.pop(tool_use_id, None)
            duration_ms = (time.monotonic() - start) * 1000 if start else None

            is_agent = tool_name in ("Agent", "Task")

            # Call the latest tool_event_callback from ps
            if ps.tool_event_callback:
                if is_agent:
                    if agent_stack and agent_stack[-1] == tool_use_id:
                        agent_stack.pop()
                    ps.tool_event_callback({
                        "type": "agent_stop",
                        "tool_name": tool_name or "Agent",
                        "tool_use_id": tool_use_id,
                        "success": True,
                        "duration_ms": duration_ms,
                        "timestamp": datetime.now().isoformat(),
                        "session_id": session_id,
                    })
                else:
                    ps.tool_event_callback({
                        "type": "tool_complete",
                        "tool_name": tool_name or "unknown",
                        "tool_use_id": tool_use_id,
                        "parent_agent_id": agent_stack[-1] if agent_stack else None,
                        "success": True,
                        "duration_ms": duration_ms,
                        "timestamp": datetime.now().isoformat(),
                        "session_id": session_id,
                    })

            return HookJSONOutput()

        return {
            "PreToolUse": [HookMatcher(hooks=[pre_tool_use])],
            "PostToolUse": [HookMatcher(hooks=[post_tool_use])],
        }

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
        model: Optional[str] = None,
    ) -> None:
        # Backward compat: maintain ActiveSession for old tests
        active = ActiveSession(session_id=session_id)
        with self._lock:
            self._active[session_id] = active

        result_text: list[str] = []
        got_result = False

        try:
            logger.info(f"_stream_query started for session {session_id}, prompt: {prompt[:50]}...")

            # Get or create persistent client
            ps = await self._get_or_create_client(session_id, workspace, model)
            logger.info(f"Got persistent client for session {session_id}, client={ps.client}")

            # Update the tool event callback to the latest one for this query
            ps.tool_event_callback = on_tool_event

            # Mark query as active
            ps.query_active = True
            ps.cancel_requested = False
            ps.last_activity = time.monotonic()

            # Send query to persistent subprocess
            # Use SDK session ID for conversation continuity, fall back to browser session ID
            query_session_id = ps.sdk_session_id or session_id
            logger.info(f"Sending query to SDK for session {session_id} (query_session_id={query_session_id})...")
            await ps.client.query(prompt, session_id=query_session_id)
            logger.info(f"Query sent to SDK for session {session_id}, starting receive loop")

            # Stream response — access the raw message stream (pre-parsing) to implement
            # error recovery. When parse_message() throws MessageParseError inside
            # receive_messages(), the generator is permanently killed. By parsing ourselves,
            # we can skip unparseable messages without breaking the stream.
            raw_iter = ps.client._query.receive_messages().__aiter__()
            while True:
                try:
                    raw_data = await raw_iter.__anext__()
                except StopAsyncIteration:
                    break

                # Parse with error recovery
                try:
                    message = sdk_parse_message(raw_data)
                except MessageParseError as mpe:
                    logger.info(f"Skipping unparseable SDK message: {mpe}")
                    continue

                logger.info(f"Received message type: {type(message).__name__} for session {session_id}")

                # Check for cancellation
                if ps.cancel_requested or active.cancel_event.is_set():
                    logger.info(f"Query cancelled for session {session_id}")
                    await ps.client.interrupt()
                    break

                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            result_text.append(block.text)
                            on_text(block.text)
                        elif isinstance(block, ToolUseBlock):
                            # Tool events come through hooks now
                            pass

                elif isinstance(message, ResultMessage):
                    got_result = True
                    usage = message.usage or {}

                    # Capture SDK session ID for potential resume
                    ps.sdk_session_id = message.session_id

                    on_complete({
                        "text": "".join(result_text),
                        "session_id": message.session_id,
                        "cost": message.total_cost_usd,
                        "duration_ms": message.duration_ms,
                        "is_error": message.is_error,
                        "num_turns": message.num_turns,
                        "input_tokens": usage.get("input_tokens"),
                        "output_tokens": usage.get("output_tokens"),
                    })
                    # ResultMessage means this query is done
                    break

                elif isinstance(message, (SystemMessage, StreamEvent, UserMessage)):
                    pass

                else:
                    logger.debug(f"Ignoring message: {type(message).__name__}")

        except Exception as e:
            logger.error(f"SDK query error for session {session_id}: {e}", exc_info=True)
            on_error(str(e))

            # Tear down the corrupted client so next query gets a fresh one
            await self._disconnect_session(session_id)

        finally:
            logger.info(f"_stream_query cleanup for session {session_id}")

            # Mark query as inactive
            with self._lock:
                ps = self._sessions.get(session_id)
                if ps:
                    ps.query_active = False
                    ps.last_activity = time.monotonic()

            # ALWAYS send completion so the frontend cursor clears
            if not got_result:
                on_complete({
                    "text": "".join(result_text),
                    "session_id": None,
                    "cost": None,
                    "duration_ms": None,
                    "is_error": False,
                    "num_turns": None,
                    "input_tokens": None,
                    "output_tokens": None,
                })

            # Backward compat: clean up ActiveSession
            with self._lock:
                self._active.pop(session_id, None)


def _safe_params(params: dict) -> dict:
    """Truncate large param values for display."""
    cleaned = {}
    for k, v in params.items():
        if k in ("tool_use_id",):
            continue
        if isinstance(v, str) and len(v) > 200:
            cleaned[k] = v[:200] + "..."
        else:
            cleaned[k] = v
    return cleaned
