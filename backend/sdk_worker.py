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
import base64
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
from claude_code_sdk.types import HookMatcher, HookContext, HookJSONOutput, PermissionResultAllow, ToolPermissionContext
from claude_code_sdk._errors import MessageParseError
from claude_code_sdk._internal.message_parser import parse_message as sdk_parse_message

# These may not be exported from top-level
try:
    from claude_code_sdk import StreamEvent, UserMessage
except ImportError:
    from claude_code_sdk.types import StreamEvent, UserMessage

from backend.database import get_image, get_last_sdk_session_id, record_tool_event, update_tool_event, record_message
import backend.config as config

# ---------------------------------------------------------------------------
# System prompt appended to every SDK session.
# Forces immediate delegation to subagents so the main conversation stays
# responsive and the user can keep chatting or switch sessions.
# ---------------------------------------------------------------------------
CCPLUS_SYSTEM_PROMPT = """
# cc+ Delegation Rules

You are running inside cc+, a multi-session web UI.

## Asking the user questions
When the user's request is ambiguous, has multiple valid approaches, or requires a choice, use the AskUserQuestion tool to present structured options. The cc+ UI renders these as selectable cards. Use it whenever you would normally ask the user to choose between approaches, confirm a direction, or clarify requirements. Do NOT just write out options as text — use AskUserQuestion so the user can click to select.

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
        self._pending_questions: dict[str, asyncio.Event] = {}
        self._question_responses: dict[str, str] = {}
        self._pending_question_data: dict[str, dict] = {}
        self._event_buffer: dict[str, list[dict]] = {}  # per-session event buffer for disconnect gaps
        self._buffer_overflow_warned: set[str] = set()  # sessions that have logged overflow warning

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

        # IMPORTANT: Replay buffered events BEFORE sending session status.
        # This order prevents false "session lost" errors when Flask reconnects
        # during heavy subagent activity. If we send status first, Flask sees
        # query_active=False for queries that finished during the gap, but the
        # response_complete event that would clear _active_sessions is still
        # buffered. By replaying first, Flask processes all completions before
        # receiving the status update, keeping _active_sessions in sync.
        if self._event_buffer:
            total = sum(len(v) for v in self._event_buffer.values())
            logger.info(f"Replaying {total} buffered events across {len(self._event_buffer)} sessions")
            for sid, events in list(self._event_buffer.items()):
                for event in events:
                    try:
                        data = encode_message(event)
                        writer.write(data)
                        await writer.drain()
                    except Exception as e:
                        logger.error(f"Error replaying buffered event: {e}")
                        return  # Don't clear buffer if replay failed
                del self._event_buffer[sid]
                # Reset overflow warning flag for this session
                self._buffer_overflow_warned.discard(sid)
            logger.info("Buffer replay complete")

        # Send session status to newly connected Flask (after replay)
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
            image_ids = msg.get("image_ids")
            await self.handle_submit_query(session_id, prompt, workspace, model, image_ids)

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

        elif msg_type == "question_response":
            session_id = msg.get("session_id")
            response = msg.get("response", "")
            await self.handle_question_response(session_id, response)

        else:
            logger.warning(f"Unknown message type: {msg_type}")

    async def handle_submit_query(
        self,
        session_id: str,
        prompt: str,
        workspace: str,
        model: Optional[str] = None,
        image_ids: Optional[list[str]] = None,
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
        asyncio.create_task(self.stream_query(session_id, prompt, workspace, model, image_ids))

    async def handle_cancel_query(self, session_id: str) -> None:
        """Cancel active query for a session."""
        ps = self._sessions.get(session_id)
        if ps and ps.query_active:
            ps.cancel_requested = True
            logger.info(f"Cancellation requested for session {session_id}")

            # Unblock any pending AskUserQuestion wait
            event = self._pending_questions.get(session_id)
            if event:
                self._question_responses[session_id] = "User cancelled the query"
                event.set()
                logger.info(f"Unblocked pending AskUserQuestion for cancelled session {session_id}")

    async def handle_disconnect_session(self, session_id: str) -> None:
        """Disconnect and tear down a session."""
        await self._disconnect_session(session_id)

    async def handle_question_response(self, session_id: str, response: str) -> None:
        """Handle user's response to an AskUserQuestion."""
        logger.info(f"[question_response] Received response for session {session_id}: {response[:100]}")
        logger.info(f"[question_response] Pending questions: {list(self._pending_questions.keys())}")
        self._question_responses[session_id] = response
        event = self._pending_questions.get(session_id)
        if event:
            logger.info(f"[question_response] Setting event for session {session_id}")
            event.set()
        else:
            logger.warning(f"No pending question for session {session_id}")

    async def send_event(self, msg: dict) -> None:
        """Send an event to Flask if connected, buffer if not."""
        if self._flask_writer is None:
            # Buffer session-scoped events for replay on reconnect
            session_id = msg.get("session_id")
            if session_id:
                buf = self._event_buffer.setdefault(session_id, [])
                if len(buf) >= config.WORKER_EVENT_BUFFER_SIZE:
                    # Only warn once per session
                    if session_id not in self._buffer_overflow_warned:
                        logger.warning(f"Event buffer full for session {session_id}, dropping oldest events")
                        self._buffer_overflow_warned.add(session_id)
                    buf.pop(0)
                buf.append(msg)
            return

        try:
            data = encode_message(msg)
            self._flask_writer.write(data)
            await self._flask_writer.drain()
        except Exception as e:
            logger.error(f"Error sending event to Flask: {e}")
            self._flask_writer = None
            # Buffer the failed event too
            session_id = msg.get("session_id")
            if session_id:
                self._event_buffer.setdefault(session_id, []).append(msg)

    async def _send_session_status(self) -> None:
        """Send status of all active sessions to Flask."""
        sessions = [
            {
                "session_id": ps.session_id,
                "query_active": ps.query_active,
                "workspace": ps.workspace,
                "model": ps.model,
                "started_at": ps.started_at,
                "pending_question": self._pending_question_data.get(ps.session_id),
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

        # Build can_use_tool callback
        can_use_tool_cb = self._build_can_use_tool(session_id)

        # Generate SDK settings from user's global settings, but with plugins
        # disabled. Plugin hooks (e.g. suggest-compact.js) reference
        # ${CLAUDE_PLUGIN_ROOT} which isn't set in the subprocess env.
        sdk_settings_path = _get_sdk_settings_path()

        # Capture subprocess stderr to a log file for debugging
        sdk_stderr_path = Path(config.LOG_DIR) / f"sdk_stderr_{session_id}.log"
        sdk_stderr = open(sdk_stderr_path, "a")
        logger.info(f"SDK subprocess stderr -> {sdk_stderr_path}")

        options = ClaudeCodeOptions(
            max_turns=50,
            cwd=workspace,
            permission_mode="bypassPermissions",
            env=clean_env,
            hooks=hooks,
            model=model or "sonnet",
            resume=resume_id or "",
            append_system_prompt=CCPLUS_SYSTEM_PROMPT,
            can_use_tool=can_use_tool_cb,
            settings=sdk_settings_path,
            debug_stderr=sdk_stderr,
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

    def _build_can_use_tool(self, session_id: str):
        """Build a can_use_tool callback that auto-allows everything and handles AskUserQuestion."""
        async def can_use_tool(
            tool_name: str,
            tool_input: dict[str, Any],
            context: ToolPermissionContext,
        ) -> PermissionResultAllow:
            # For AskUserQuestion, collect answers from the web UI
            if tool_name == "AskUserQuestion":
                questions = tool_input.get("questions", [])
                tool_use_id = f"perm_{time.monotonic()}"
                logger.info(f"[AskUserQuestion] Permission request with {len(questions)} questions for session {session_id}")

                # Store question data for reconnect scenarios
                self._pending_question_data[session_id] = {
                    "questions": questions,
                    "tool_use_id": tool_use_id,
                }

                # Emit question to frontend
                await self.send_event({
                    "type": "user_question",
                    "session_id": session_id,
                    "questions": questions,
                    "tool_use_id": tool_use_id,
                })

                # Wait for user response (up to 5 minutes)
                logger.info(f"[AskUserQuestion] Waiting for user response for session {session_id}")
                wait_event = asyncio.Event()
                self._pending_questions[session_id] = wait_event
                try:
                    await asyncio.wait_for(wait_event.wait(), timeout=300)
                    user_response = self._question_responses.pop(session_id, "")
                    logger.info(f"[AskUserQuestion] Got user response: {user_response[:100]}")
                except asyncio.TimeoutError:
                    user_response = "User did not respond in time"
                    logger.warning(f"[AskUserQuestion] Timed out waiting for response")
                finally:
                    self._pending_questions.pop(session_id, None)
                    self._pending_question_data.pop(session_id, None)

                # Parse the response string into answers dict
                # Frontend sends: "Header1: Selection1\nHeader2: Selection2"
                answers = {}
                for line in user_response.split('\n'):
                    line = line.strip()
                    if not line:
                        continue
                    # Match each answer line to its question by header
                    for q in questions:
                        header = q.get("header", "")
                        if line.startswith(f"{header}: "):
                            answer_text = line[len(f"{header}: "):]
                            answers[q.get("question", header)] = answer_text
                            break

                # Return allow with updated input that includes answers
                updated = {**tool_input, "answers": answers}
                logger.info(f"[AskUserQuestion] Returning allow with answers: {answers}")
                return PermissionResultAllow(updated_input=updated)

            # Auto-allow all other tools
            logger.info(f"[can_use_tool] Auto-allowing {tool_name} for session {session_id}")
            return PermissionResultAllow()

        return can_use_tool

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
            logger.info(f"[pre_tool_use] tool_name={actual_tool_name}, tool_use_id={tool_use_id_param}")
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
                    "parent_agent_id": None,
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

                # Include content params for Write/Edit tools to enable LOC counting
                if actual_tool_name in ("Write", "Edit"):
                    loc_params = {}
                    if "content" in tool_params:
                        loc_params["content"] = tool_params["content"]
                    if "new_string" in tool_params:
                        loc_params["new_string"] = tool_params["new_string"]
                    if loc_params:
                        event["parameters"] = loc_params

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
        image_ids: Optional[list[str]] = None,
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

            # Build query content (text + images)
            if image_ids:
                # Fetch images from database and build content with image blocks
                # Build content blocks: images first, then text
                content_blocks = []

                for img_id in image_ids:
                    try:
                        img = get_image(img_id)
                        if img:
                            img_data_b64 = base64.b64encode(img["data"]).decode("utf-8")
                            # Determine media type from mime_type
                            media_type = img["mime_type"]
                            if media_type == "image/jpg":
                                media_type = "image/jpeg"

                            content_blocks.append({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": img_data_b64,
                                }
                            })
                            logger.info(f"Added image {img_id} to query content")
                    except Exception as e:
                        logger.error(f"Failed to load image {img_id}: {e}")

                # Add text prompt after images
                if prompt:
                    content_blocks.append({
                        "type": "text",
                        "text": prompt,
                    })

                logger.info(f"Query has {len(content_blocks)} content blocks ({len(image_ids)} images)")

                # SDK expects an AsyncIterable that yields streaming protocol messages
                # Each yielded dict must have {"type": "user", "message": {"role": "user", "content": [...]}}
                async def message_stream():
                    yield {
                        "type": "user",
                        "message": {
                            "role": "user",
                            "content": content_blocks,
                        }
                    }

                query_content = message_stream()
            else:
                query_content = prompt

            # Send query to persistent subprocess
            query_session_id = ps.sdk_session_id or session_id
            logger.info(f"Sending query to SDK for session {session_id} (query_session_id={query_session_id})...")
            await ps.client.query(query_content, session_id=query_session_id)
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
                    current_message_text = []  # Track text for this specific AssistantMessage
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            result_text.append(block.text)
                            current_message_text.append(block.text)
                            await self.send_event({
                                "type": "text_delta",
                                "session_id": session_id,
                                "text": block.text,
                            })
                            has_text = True
                        elif isinstance(block, ToolUseBlock):
                            pass

                    # Persist to DB (worker is the authority for message persistence)
                    # Create a separate database record for each distinct AssistantMessage
                    if has_text:
                        try:
                            # Always create a new message for each AssistantMessage to ensure proper separation
                            msg = record_message(session_id, "assistant", "assistant", "".join(current_message_text))
                            current_msg_id = msg.get("id")

                            # Keep track of the first message ID for final ResultMessage handling
                            if assistant_msg_id is None:
                                assistant_msg_id = current_msg_id
                        except Exception as e:
                            logger.error(f"Failed to record assistant message: {e}")

                    # After each AssistantMessage with text, signal intermediate completion
                    # Send only the current message's text, not accumulated text
                    if has_text:
                        await self.send_event({
                            "type": "response_complete",
                            "session_id": session_id,
                            "text": "".join(current_message_text),
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

                    # Note: We now create separate database records for each AssistantMessage,
                    # so we don't need to update with accumulated text here.
                    # The sdk_session_id will be set on the final response_complete event.

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


def _get_sdk_settings_path() -> str:
    """Build a derived settings file for SDK subprocesses.

    Reads the user's global ~/.claude/settings.json, strips ``enabledPlugins``
    (plugin hooks reference env vars unavailable in the subprocess), and writes
    the result to data/sdk_settings.json.  Everything else (user hooks, model
    preferences, etc.) is preserved.

    The file is regenerated on every call so it stays in sync if the user
    edits their global settings between sessions.
    """
    user_settings_path = Path.home() / ".claude" / "settings.json"
    sdk_settings_path = Path(config.DATA_DIR) / "sdk_settings.json"

    settings: dict = {}
    if user_settings_path.exists():
        try:
            settings = json.loads(user_settings_path.read_text())
        except Exception as e:
            logger.warning(f"Failed to read user settings: {e}")

    # Disable plugins — their hooks can't resolve ${CLAUDE_PLUGIN_ROOT}
    settings.pop("enabledPlugins", None)
    settings.pop("extraKnownMarketplaces", None)

    sdk_settings_path.write_text(json.dumps(settings, indent=2))
    return str(sdk_settings_path)


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
