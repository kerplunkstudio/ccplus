"""
SDK Hook Callbacks -- track tool usage and agent hierarchy.

Maintains an "agent stack" per session to assign parent-child relationships
between Agent tool calls and their nested tool calls. Emits events via
callback for real-time WebSocket forwarding.

Design principles:
    - HookManager owns a per-session agent stack (list of tool_use_ids)
    - ``current_parent_id`` always reflects the innermost active agent
    - All events are emitted via ``on_event`` callback for decoupled delivery
    - Thread-safety enforced via threading.Lock on the agent stack
    - Dangerous Bash commands are blocked at the pre_tool_use gate
    - Database writes are best-effort (failures logged, never propagated)
    - Parameter serialization truncates large values to prevent memory bloat
"""

import json
import logging
import threading
import time
from datetime import datetime
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class HookManager:
    """Manages SDK hook callbacks with agent stack tracking.

    The agent stack tracks nested Agent/Task tool calls so that every
    tool event can be tagged with its ``parent_agent_id``. When an Agent
    tool starts, its ``tool_use_id`` is pushed onto the stack. When it
    completes, it is popped. All non-agent tools that execute while an
    agent is on the stack inherit that agent as their parent.

    Args:
        session_id: Unique identifier for the session being tracked.
        on_event: Callback that receives event dicts for WebSocket forwarding.
        db: Optional database interface with a ``record_tool_event`` method.

    Example agent stack evolution::

        []                          # No agents running
        ["agent-001"]               # Outer agent started
        ["agent-001", "agent-002"]  # Nested agent started
        ["agent-001"]               # Nested agent completed
        []                          # Outer agent completed
    """

    def __init__(
        self,
        session_id: str,
        on_event: Callable[[dict], None],
        db=None,
    ) -> None:
        self.session_id = session_id
        self.on_event = on_event
        self.db = db
        self._agent_stack: list[str] = []  # Stack of agent tool_use_ids
        self._tool_timers: dict[str, float] = {}  # tool_use_id -> monotonic start time
        self._lock = threading.Lock()

    @property
    def current_parent_id(self) -> Optional[str]:
        """Get the current parent agent ID (top of stack).

        Returns None when no agent is active (tools running at root level).
        """
        with self._lock:
            return self._agent_stack[-1] if self._agent_stack else None

    # ------------------------------------------------------------------
    # Pre-tool hook
    # ------------------------------------------------------------------

    def pre_tool_use(
        self, session_id: str, tool_name: str, tool_input: dict
    ) -> Optional[dict]:
        """Called before a tool is executed.

        Responsibilities:
            1. Start a monotonic timer for duration tracking.
            2. Push agent tool_use_ids onto the agent stack.
            3. Emit ``agent_start`` or ``tool_start`` event via callback.
            4. Block dangerous Bash commands.

        Args:
            session_id: The session this tool belongs to.
            tool_name: Name of the tool being invoked (e.g., "Bash", "Agent").
            tool_input: Tool parameters dict. Must contain ``tool_use_id``.

        Returns:
            None to allow execution, or a dict with ``{"decision": "block",
            "reason": "..."}`` to prevent the tool from running.
        """
        tool_use_id = tool_input.get("tool_use_id", "")

        # Start timing
        self._tool_timers[tool_use_id] = time.monotonic()

        # Detect agent/subagent tools
        is_agent = tool_name in ("Agent", "Task")
        agent_type = tool_input.get("subagent_type") if is_agent else None

        if is_agent:
            with self._lock:
                parent_id = self._agent_stack[-1] if self._agent_stack else None
                self._agent_stack.append(tool_use_id)

            event = {
                "type": "agent_start",
                "tool_name": tool_name,
                "tool_use_id": tool_use_id,
                "parent_agent_id": parent_id,
                "agent_type": agent_type,
                "description": tool_input.get("description", ""),
                "timestamp": datetime.now().isoformat(),
                "session_id": self.session_id,
            }
        else:
            event = {
                "type": "tool_start",
                "tool_name": tool_name,
                "tool_use_id": tool_use_id,
                "parent_agent_id": self.current_parent_id,
                "parameters": _safe_serialize_params(tool_input),
                "timestamp": datetime.now().isoformat(),
                "session_id": self.session_id,
            }

        self._emit_event(event)

        # Block dangerous Bash operations
        if tool_name == "Bash":
            command = tool_input.get("command", "")
            block_result = _check_dangerous_command(command)
            if block_result is not None:
                return block_result

        return None

    # ------------------------------------------------------------------
    # Post-tool hook
    # ------------------------------------------------------------------

    def post_tool_use(
        self,
        session_id: str,
        tool_name: str,
        tool_input: dict,
        tool_output: dict,
    ) -> None:
        """Called after a tool completes.

        Responsibilities:
            1. Calculate duration from the timer started in pre_tool_use.
            2. Pop agent tool_use_ids from the agent stack.
            3. Emit ``agent_stop`` or ``tool_complete`` event via callback.
            4. Record event to database (best-effort).

        Args:
            session_id: The session this tool belongs to.
            tool_name: Name of the tool that completed.
            tool_input: Original tool parameters (for tool_use_id lookup).
            tool_output: Tool result dict, may contain ``error`` key.
        """
        tool_use_id = tool_input.get("tool_use_id", "")

        # Calculate duration
        start_time = self._tool_timers.pop(tool_use_id, None)
        duration_ms = (time.monotonic() - start_time) * 1000 if start_time else None

        # Determine success/error
        error = tool_output.get("error")
        success = error is None

        is_agent = tool_name in ("Agent", "Task")

        if is_agent:
            with self._lock:
                if self._agent_stack and self._agent_stack[-1] == tool_use_id:
                    self._agent_stack.pop()

            event = {
                "type": "agent_stop",
                "tool_name": tool_name,
                "tool_use_id": tool_use_id,
                "success": success,
                "error": error,
                "duration_ms": duration_ms,
                "timestamp": datetime.now().isoformat(),
                "session_id": self.session_id,
            }
        else:
            event = {
                "type": "tool_complete",
                "tool_name": tool_name,
                "tool_use_id": tool_use_id,
                "parent_agent_id": self.current_parent_id,
                "success": success,
                "error": error,
                "duration_ms": duration_ms,
                "timestamp": datetime.now().isoformat(),
                "session_id": self.session_id,
            }

            # Include untruncated parameters for Write and Edit tools to enable LOC tracking
            if tool_name in ("Write", "Edit") and success:
                event["parameters"] = _get_loc_params(tool_input)

        self._emit_event(event)
        self._record_to_db(tool_name, tool_use_id, tool_input, is_agent, success, error, duration_ms)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _emit_event(self, event: dict) -> None:
        """Emit an event via the on_event callback, swallowing errors."""
        try:
            self.on_event(event)
        except Exception as e:
            logger.error(f"Hook event emission failed: {e}")

    def _record_to_db(
        self,
        tool_name: str,
        tool_use_id: str,
        tool_input: dict,
        is_agent: bool,
        success: bool,
        error: Optional[str],
        duration_ms: Optional[float],
    ) -> None:
        """Record a tool event to the database (best-effort).

        Database failures are logged but never propagated. This ensures
        hook callbacks remain crash-proof even if the DB is unavailable.
        """
        if not self.db:
            return

        try:
            self.db.record_tool_event(
                session_id=self.session_id,
                tool_name=tool_name,
                tool_use_id=tool_use_id,
                parent_agent_id=self.current_parent_id if not is_agent else None,
                agent_type=tool_input.get("subagent_type") if is_agent else None,
                success=success,
                error=error,
                duration_ms=duration_ms,
                parameters=_safe_serialize_params(tool_input),
            )
        except Exception as e:
            logger.error(f"Database write failed: {e}")


# ----------------------------------------------------------------------
# Module-level helpers
# ----------------------------------------------------------------------

# Bash command patterns that should be blocked.
# Each tuple: (substring to detect, human-readable reason).
_BLOCKED_COMMAND_PATTERNS: tuple[tuple[str, str], ...] = (
    ("--force", "Force flags are blocked by default"),
    ("--hard", "Hard reset is blocked without confirmation"),
    ("rm -rf /", "Recursive deletion of root is never allowed"),
)


def _check_dangerous_command(command: str) -> Optional[dict]:
    """Check if a Bash command contains a blocked pattern.

    Returns:
        A block response dict if the command should be prevented,
        None otherwise.
    """
    for pattern, reason in _BLOCKED_COMMAND_PATTERNS:
        if pattern in command:
            logger.warning(f"Blocked dangerous command: {reason} (pattern={pattern!r})")
            return {"decision": "block", "reason": f"Blocked dangerous command: {command[:100]}"}
    return None


def _get_loc_params(params: dict) -> dict:
    """Extract parameters needed for lines of code counting.

    Returns only the content-related parameters (content, new_string) without
    truncation for accurate line counting in the frontend.

    Args:
        params: Raw tool parameters dict.

    Returns:
        Dict containing only LOC-relevant parameters.
    """
    loc_params = {}
    if "content" in params:
        loc_params["content"] = params["content"]
    if "new_string" in params:
        loc_params["new_string"] = params["new_string"]
    return loc_params


def _safe_serialize_params(params: dict) -> str:
    """Safely serialize parameters to JSON, truncating large values.

    Removes internal keys (``tool_use_id``) and truncates string values
    longer than 500 characters to prevent memory bloat in logs and DB.

    Args:
        params: Raw tool parameters dict.

    Returns:
        JSON string of the cleaned parameters. Returns ``"{}"`` if
        serialization fails for any reason.
    """
    try:
        cleaned = {}
        for k, v in params.items():
            if k in ("tool_use_id",):
                continue
            if isinstance(v, str) and len(v) > 500:
                cleaned[k] = v[:500] + "..."
            else:
                cleaned[k] = v
        return json.dumps(cleaned, default=str)
    except Exception:
        return "{}"
