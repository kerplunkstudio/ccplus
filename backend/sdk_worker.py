"""
SDK Worker Process -- standalone process managing Claude Code SDK sessions.

This process survives Flask restarts. It listens on a Unix domain socket
and manages persistent SDK sessions that stream events back to Flask.

Architecture:
    - Runs as standalone asyncio process
    - Listens on Unix socket: data/sdk_worker.sock
    - Maintains dict of PersistentSession objects (each with ClaudeSDKClient)
    - Accepts JSON-line messages from Flask
    - Streams events (text_delta, tool_event, response_complete, error) back
    - SDK sessions survive Flask restarts (events during downtime are dropped)
    - Writes tool events to SQLite directly
    - Graceful shutdown on SIGTERM
    - Logs to logs/worker.log
    - Writes PID to data/sdk_worker.pid

Protocol (JSON-lines over Unix socket):
    Flask -> Worker:
        {"type": "submit_query", "session_id": "...", "prompt": "...", "workspace": "/path", "model": "sonnet"}
        {"type": "cancel_query", "session_id": "..."}
        {"type": "disconnect_session", "session_id": "..."}
        {"type": "list_sessions"}
        {"type": "ping"}

    Worker -> Flask:
        {"type": "text_delta", "session_id": "...", "text": "..."}
        {"type": "tool_event", "session_id": "...", "event": {...}}
        {"type": "response_complete", "session_id": "...", "cost": 0.01, ...}
        {"type": "error", "session_id": "...", "message": "..."}
        {"type": "query_ack", "session_id": "...", "status": "ok"}
        {"type": "session_status", "sessions": [{"session_id": "...", "query_active": true, "workspace": "..."}]}
        {"type": "pong"}
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

# Remove CLAUDECODE env var to allow SDK subprocess spawning
# (otherwise Claude Code detects "nested session" and refuses to start)
os.environ.pop("CLAUDECODE", None)

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from claude_code_sdk import (
    AssistantMessage,
    ClaudeCodeOptions,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
)
from claude_code_sdk.types import HookMatcher, HookContext, HookJSONOutput
from claude_code_sdk._errors import MessageParseError
from claude_code_sdk._internal.message_parser import parse_message as sdk_parse_message

# These may not be exported from top-level
try:
    from claude_code_sdk import StreamEvent, UserMessage
except ImportError:
    from claude_code_sdk.types import StreamEvent, UserMessage

from backend.database import get_last_sdk_session_id, record_tool_event, update_tool_event, record_message, update_message
import backend.config as config

# ---------------------------------------------------------------------------
# System prompt appended to every SDK session.
# Forces immediate delegation to subagents so the main conversation stays
# responsive and the user can keep chatting or switch sessions.
# ---------------------------------------------------------------------------
CCPLUS_SYSTEM_PROMPT = """
# cc+ Delegation Rules

You are running inside cc+, a multi-session web UI.

## Small tasks (handle directly)
Questions, reading files, explaining code, searching, quick single-file edits, small bug fixes — handle these yourself using any tools you need.

## Large tasks (delegate to a subagent)
Tasks that involve reading or writing MANY files, implementing features across multiple modules, large refactors, or multi-step implementation work — delegate these to a subagent.

How to delegate:
1. Say ONE short sentence (e.g., "Delegating to an agent.").
2. Call the Agent tool ONCE with:
   - `subagent_type`: "code_agent"
   - `prompt`: The user's full request, followed by:

```
You have full autonomy to complete this task end-to-end. Steps:
1. Explore the codebase to understand the project structure and relevant files.
2. Implement all changes needed.
3. Run tests if applicable.
4. Commit your changes when done.
Do NOT ask for clarification. Make reasonable assumptions and proceed.
```

3. STOP after the Agent call. Do not continue working.
""".strip()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(config.WORKER_LOG),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)


def encode_message(msg: dict) -> bytes:
    """Encode a message dict to JSON bytes with newline."""
    return json.dumps(msg, default=str).encode("utf-8") + b"\n"


@dataclass
class PersistentSession:
    """A persistent SDK client for one browser session.

    The client subprocess remains alive across multiple messages,
    eliminating spawn overhead.
    """
    session_id: str
    client: Any  # ClaudeSDKClient
    workspace: Optional[str] = None
    model: Optional[str] = None
    sdk_session_id: Optional[str] = None
    query_active: bool = False
    cancel_requested: bool = False
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    last_activity: float = field(default_factory=time.monotonic)


class SDKWorker:
    """Standalone worker managing Claude Code SDK sessions."""

    def __init__(self) -> None:
        self._sessions: dict[str, PersistentSession] = {}
        self._flask_writer: Optional[asyncio.StreamWriter] = None
        self._shutdown_requested = False
        self._socket_path = config.WORKER_SOCKET_PATH
        self._pid_path = config.WORKER_PID_PATH

    async def start(self) -> None:
        """Start the worker, create socket, and listen for connections."""
        # Remove stale socket file
        if os.path.exists(self._socket_path):
            os.remove(self._socket_path)
            logger.info(f"Removed stale socket: {self._socket_path}")

        # Write PID file
        with open(self._pid_path, "w") as f:
            f.write(str(os.getpid()))
        logger.info(f"Worker PID: {os.getpid()}")

        # Set up SIGTERM handler
        loop = asyncio.get_event_loop()
        loop.add_signal_handler(signal.SIGTERM, self._handle_sigterm)

        # Create Unix socket server
        server = await asyncio.start_unix_server(
            self.handle_client,
            path=self._socket_path,
        )
        logger.info(f"SDK worker listening on {self._socket_path}")

        async with server:
            await server.serve_forever()

    def _handle_sigterm(self) -> None:
        """Handle SIGTERM for graceful shutdown."""
        logger.info("Received SIGTERM, initiating graceful shutdown")
        self._shutdown_requested = True
        asyncio.create_task(self._shutdown())

    async def _shutdown(self) -> None:
        """Gracefully shut down all sessions and clean up."""
        logger.info("Shutting down SDK worker")

        # Disconnect all clients
        for session_id in list(self._sessions.keys()):
            await self._disconnect_session(session_id)

        # Remove socket and PID files
        if os.path.exists(self._socket_path):
            os.remove(self._socket_path)
        if os.path.exists(self._pid_path):
            os.remove(self._pid_path)

        logger.info("SDK worker shutdown complete")
        sys.exit(0)

    async def handle_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        """Handle a Flask connection on the Unix socket."""
        logger.info("Flask connected to SDK worker")
        self._flask_writer = writer

        # Send session status to newly connected Flask
        await self._send_session_status()

        try:
            while not self._shutdown_requested:
                line = await reader.readline()
                if not line:
                    logger.info("Flask disconnected (EOF)")
                    break

                try:
                    msg = json.loads(line.decode("utf-8"))
                    await self._handle_message(msg)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON from Flask: {e}")
                except Exception as e:
                    logger.error(f"Error handling message: {e}", exc_info=True)

        except asyncio.CancelledError:
            logger.info("Client handler cancelled")
        except Exception as e:
            logger.error(f"Client handler error: {e}", exc_info=True)
        finally:
            self._flask_writer = None
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            logger.info("Flask disconnected from SDK worker")

    async def _handle_message(self, msg: dict) -> None:
        """Dispatch incoming message to appropriate handler."""
        msg_type = msg.get("type")

        if msg_type == "submit_query":
            session_id = msg.get("session_id")
            prompt = msg.get("prompt")
            workspace = msg.get("workspace")
            model = msg.get("model")
            await self.handle_submit_query(session_id, prompt, workspace, model)

        elif msg_type == "cancel_query":
            session_id = msg.get("session_id")
            await self.handle_cancel_query(session_id)

        elif msg_type == "disconnect_session":
            session_id = msg.get("session_id")
            await self.handle_disconnect_session(session_id)

        elif msg_type == "list_sessions":
            await self._send_session_status()

        elif msg_type == "ping":
            await self.send_event({"type": "pong"})

        else:
            logger.warning(f"Unknown message type: {msg_type}")

    async def handle_submit_query(
        self,
        session_id: str,
        prompt: str,
        workspace: str,
        model: Optional[str] = None,
    ) -> None:
        """Submit a query to the SDK for a session."""
        logger.info(f"Submitting query for session {session_id}")

        # Send acknowledgment
        await self.send_event({
            "type": "query_ack",
            "session_id": session_id,
            "status": "ok",
        })

        # Start streaming query in background
        asyncio.create_task(self.stream_query(session_id, prompt, workspace, model))

    async def handle_cancel_query(self, session_id: str) -> None:
        """Cancel active query for a session."""
        ps = self._sessions.get(session_id)
        if ps and ps.query_active:
            ps.cancel_requested = True
            logger.info(f"Cancellation requested for session {session_id}")

    async def handle_disconnect_session(self, session_id: str) -> None:
        """Disconnect and tear down a session."""
        await self._disconnect_session(session_id)

    async def send_event(self, msg: dict) -> None:
        """Send an event to Flask if connected, drop silently if not."""
        if self._flask_writer is None:
            return

        try:
            data = encode_message(msg)
            self._flask_writer.write(data)
            await self._flask_writer.drain()
        except Exception as e:
            logger.error(f"Error sending event to Flask: {e}")
            self._flask_writer = None

    async def _send_session_status(self) -> None:
        """Send status of all active sessions to Flask."""
        sessions = [
            {
                "session_id": ps.session_id,
                "query_active": ps.query_active,
                "workspace": ps.workspace,
                "model": ps.model,
                "started_at": ps.started_at,
            }
            for ps in self._sessions.values()
        ]
        await self.send_event({
            "type": "session_status",
            "sessions": sessions,
        })

    async def get_or_create_client(
        self,
        session_id: str,
        workspace: str,
        model: Optional[str] = None,
    ) -> PersistentSession:
        """Get or create a persistent ClaudeSDKClient for this session."""
        ps = self._sessions.get(session_id)

        if ps and ps.client:
            # If workspace or model changed, tear down and recreate
            if (ps.workspace and ps.workspace != workspace) or (model and ps.model and ps.model != model):
                logger.info(
                    f"Workspace or model changed for session {session_id}: "
                    f"workspace={ps.workspace}->{workspace}, model={ps.model}->{model}"
                )
                await self._disconnect_session(session_id)
            else:
                # Reuse existing client
                logger.debug(f"Reusing persistent client for session {session_id}")
                return ps

        # Create new client
        logger.info(f"Creating new persistent client for session {session_id}")

        clean_env = {
            k: v for k, v in os.environ.items()
            if k != "CLAUDECODE"
        }

        # Create PersistentSession instance
        ps = PersistentSession(
            session_id=session_id,
            client=None,
            workspace=workspace,
            model=model,
        )

        # Build hooks
        hooks = self._build_hooks(session_id, ps)

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
            model=model or "sonnet",
            resume=resume_id or "",
            append_system_prompt=CCPLUS_SYSTEM_PROMPT,
        )

        client = ClaudeSDKClient(options)
        await client.connect()

        ps.client = client
        self._sessions[session_id] = ps

        return ps

    async def _disconnect_session(self, session_id: str) -> None:
        """Disconnect and remove a persistent session."""
        ps = self._sessions.pop(session_id, None)

        if ps and ps.client:
            try:
                logger.info(f"Disconnecting persistent client for session {session_id}")
                await ps.client.disconnect()
            except Exception as exc:
                logger.error(f"Error disconnecting client for {session_id}: {exc}")

    def _build_hooks(
        self,
        session_id: str,
        ps: PersistentSession,
    ) -> dict:
        """Build SDK hook callbacks that forward tool events."""
        tool_timers: dict[str, float] = {}
        agent_stack: list[str] = []

        async def pre_tool_use(
            hook_input: dict[str, Any],
            tool_use_id_param: str | None,
            context: HookContext,
        ) -> HookJSONOutput:
            actual_tool_name = hook_input.get("tool_name", "unknown")
            tool_use_id = tool_use_id_param or hook_input.get("tool_use_id", f"tu_{time.monotonic()}")
            tool_params = hook_input.get("tool_input", {})
            tool_timers[tool_use_id] = time.monotonic()

            is_agent = actual_tool_name in ("Agent", "Task")
            parent_id = agent_stack[-1] if agent_stack else None

            if is_agent:
                agent_stack.append(tool_use_id)
                event = {
                    "type": "agent_start",
                    "tool_name": actual_tool_name,
                    "tool_use_id": tool_use_id,
                    "parent_agent_id": parent_id,
                    "agent_type": tool_params.get("subagent_type", "agent"),
                    "description": tool_params.get("description", tool_params.get("prompt", "")[:100]),
                    "timestamp": datetime.now().isoformat(),
                    "session_id": session_id,
                }
            else:
                event = {
                    "type": "tool_start",
                    "tool_name": actual_tool_name,
                    "tool_use_id": tool_use_id,
                    "parent_agent_id": parent_id,
                    "parameters": _safe_params(tool_params),
                    "timestamp": datetime.now().isoformat(),
                    "session_id": session_id,
                }

            # Send event to Flask
            await self.send_event({
                "type": "tool_event",
                "session_id": session_id,
                "event": event,
            })

            # Record start event to database (success=None means "running")
            try:
                record_tool_event(
                    session_id=session_id,
                    tool_name=actual_tool_name,
                    tool_use_id=tool_use_id,
                    parent_agent_id=parent_id,
                    agent_type=tool_params.get("subagent_type") if is_agent else None,
                    success=None,  # Running
                    error=None,
                    duration_ms=None,
                    parameters=_safe_params(tool_params) if not is_agent else None,
                )
            except Exception as e:
                logger.error(f"Database write failed (pre_tool_use): {e}")

            return HookJSONOutput()

        async def post_tool_use(
            hook_input: dict[str, Any],
            tool_use_id_param: str | None,
            context: HookContext,
        ) -> HookJSONOutput:
            actual_tool_name = hook_input.get("tool_name", "unknown")
            tool_use_id = tool_use_id_param or hook_input.get("tool_use_id", "")
            start = tool_timers.pop(tool_use_id, None)
            duration_ms = (time.monotonic() - start) * 1000 if start else None

            is_agent = actual_tool_name in ("Agent", "Task")
            tool_params = hook_input.get("tool_input", {})

            if is_agent:
                if agent_stack and agent_stack[-1] == tool_use_id:
                    agent_stack.pop()
                event = {
                    "type": "agent_stop",
                    "tool_name": actual_tool_name,
                    "tool_use_id": tool_use_id,
                    "success": True,
                    "duration_ms": duration_ms,
                    "timestamp": datetime.now().isoformat(),
                    "session_id": session_id,
                }
            else:
                event = {
                    "type": "tool_complete",
                    "tool_name": actual_tool_name,
                    "tool_use_id": tool_use_id,
                    "parent_agent_id": agent_stack[-1] if agent_stack else None,
                    "success": True,
                    "duration_ms": duration_ms,
                    "timestamp": datetime.now().isoformat(),
                    "session_id": session_id,
                }

            # Send event to Flask
            await self.send_event({
                "type": "tool_event",
                "session_id": session_id,
                "event": event,
            })

            # Update existing DB record
            try:
                update_tool_event(
                    session_id=session_id,
                    tool_use_id=tool_use_id,
                    success=True,
                    error=None,
                    duration_ms=duration_ms,
                )
            except Exception as e:
                logger.error(f"Database write failed (post_tool_use): {e}")

            return HookJSONOutput()

        return {
            "PreToolUse": [HookMatcher(hooks=[pre_tool_use])],
            "PostToolUse": [HookMatcher(hooks=[post_tool_use])],
        }

    async def stream_query(
        self,
        session_id: str,
        prompt: str,
        workspace: str,
        model: Optional[str] = None,
    ) -> None:
        """Stream a query to the SDK and emit events to Flask."""
        result_text: list[str] = []
        got_result = False
        assistant_msg_id = None

        try:
            logger.info(f"stream_query started for session {session_id}, prompt: {prompt[:50]}...")

            # Get or create persistent client
            ps = await self.get_or_create_client(session_id, workspace, model)
            logger.info(f"Got persistent client for session {session_id}, client={ps.client}")

            # Mark query as active
            ps.query_active = True
            ps.cancel_requested = False
            ps.last_activity = time.monotonic()

            # Send query to persistent subprocess
            query_session_id = ps.sdk_session_id or session_id
            logger.info(f"Sending query to SDK for session {session_id} (query_session_id={query_session_id})...")
            await ps.client.query(prompt, session_id=query_session_id)
            logger.info(f"Query sent to SDK for session {session_id}, starting receive loop")

            # Stream response with error recovery
            raw_iter = ps.client._query.receive_messages().__aiter__()
            last_completion_data = {}

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
                if ps.cancel_requested:
                    logger.info(f"Query cancelled for session {session_id}")
                    await ps.client.interrupt()
                    try:
                        async for leftover in raw_iter:
                            try:
                                leftover_msg = sdk_parse_message(leftover)
                                if isinstance(leftover_msg, ResultMessage):
                                    got_result = True
                                    ps.sdk_session_id = leftover_msg.session_id
                                    break
                            except MessageParseError:
                                continue
                    except Exception:
                        pass
                    break

                if isinstance(message, AssistantMessage):
                    has_text = False
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            result_text.append(block.text)
                            await self.send_event({
                                "type": "text_delta",
                                "session_id": session_id,
                                "text": block.text,
                            })
                            has_text = True
                        elif isinstance(block, ToolUseBlock):
                            pass

                    # Persist to DB (worker is the authority for message persistence)
                    if has_text:
                        if assistant_msg_id is None:
                            try:
                                msg = record_message(session_id, "assistant", "assistant", "".join(result_text))
                                assistant_msg_id = msg.get("id")
                            except Exception as e:
                                logger.error(f"Failed to record assistant message: {e}")
                        else:
                            try:
                                update_message(assistant_msg_id, "".join(result_text))
                            except Exception as e:
                                logger.error(f"Failed to update assistant message: {e}")

                    # After each AssistantMessage with text, signal intermediate completion
                    if has_text:
                        await self.send_event({
                            "type": "response_complete",
                            "session_id": session_id,
                            "text": "".join(result_text),
                            "sdk_session_id": None,
                            "cost": None,
                            "duration_ms": None,
                            "is_error": False,
                            "num_turns": None,
                            "input_tokens": None,
                            "output_tokens": None,
                            "model": ps.model,
                        })

                elif isinstance(message, ResultMessage):
                    got_result = True
                    usage = message.usage or {}

                    # Capture SDK session ID for resume
                    ps.sdk_session_id = message.session_id

                    last_completion_data = {
                        "text": "".join(result_text),
                        "sdk_session_id": message.session_id,
                        "cost": message.total_cost_usd,
                        "duration_ms": message.duration_ms,
                        "is_error": message.is_error,
                        "num_turns": message.num_turns,
                        "input_tokens": usage.get("input_tokens"),
                        "output_tokens": usage.get("output_tokens"),
                        "model": ps.model,
                    }

                    # Finalize assistant message with sdk_session_id
                    if assistant_msg_id and message.session_id:
                        try:
                            update_message(
                                assistant_msg_id,
                                "".join(result_text),
                                sdk_session_id=message.session_id,
                            )
                        except Exception as e:
                            logger.error(f"Failed to finalize assistant message: {e}")

                    break

                elif isinstance(message, (SystemMessage, StreamEvent, UserMessage)):
                    pass

                else:
                    logger.debug(f"Ignoring message: {type(message).__name__}")

            # Emit final completion with metadata
            if got_result and last_completion_data:
                await self.send_event({
                    "type": "response_complete",
                    "session_id": session_id,
                **last_completion_data,
                })

        except Exception as e:
            logger.error(f"SDK query error for session {session_id}: {e}", exc_info=True)
            await self.send_event({
                "type": "error",
                "session_id": session_id,
                "message": str(e),
            })

            # Tear down corrupted client
            await self._disconnect_session(session_id)

        finally:
            logger.info(f"stream_query cleanup for session {session_id}")

            # Mark query as inactive
            ps = self._sessions.get(session_id)
            if ps:
                ps.query_active = False
                ps.last_activity = time.monotonic()

            # Always send completion so frontend cursor clears
            if not got_result:
                await self.send_event({
                    "type": "response_complete",
                    "session_id": session_id,
                    "text": "".join(result_text),
                    "sdk_session_id": None,
                    "cost": None,
                    "duration_ms": None,
                    "is_error": False,
                    "num_turns": None,
                    "input_tokens": None,
                    "output_tokens": None,
                    "model": ps.model if ps else None,
                })


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


if __name__ == "__main__":
    worker = SDKWorker()
    asyncio.run(worker.start())
