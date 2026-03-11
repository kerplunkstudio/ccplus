"""Tests for backend.sdk_hooks -- HookManager and helpers."""

import sys
import json
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend.sdk_hooks import HookManager, _check_dangerous_command, _safe_serialize_params


class TestSafeSerializeParams:
    """Tests for the _safe_serialize_params helper."""

    def test_simple_params(self):
        result = _safe_serialize_params({"command": "ls", "flag": "-la"})
        parsed = json.loads(result)
        assert parsed == {"command": "ls", "flag": "-la"}

    def test_truncates_long_strings(self):
        long_value = "x" * 600
        result = _safe_serialize_params({"data": long_value})
        parsed = json.loads(result)
        assert len(parsed["data"]) == 503  # 500 + "..."
        assert parsed["data"].endswith("...")

    def test_removes_tool_use_id(self):
        result = _safe_serialize_params({"tool_use_id": "abc", "name": "test"})
        parsed = json.loads(result)
        assert "tool_use_id" not in parsed
        assert parsed["name"] == "test"

    def test_empty_params(self):
        result = _safe_serialize_params({})
        assert result == "{}"

    def test_non_serializable_falls_back(self):
        """Non-JSON-serializable values use default=str fallback."""
        result = _safe_serialize_params({"path": Path("/tmp")})
        parsed = json.loads(result)
        assert parsed["path"] == "/tmp"

    def test_broken_dict_returns_empty(self):
        """If params cause any error, return '{}'."""

        class BadDict(dict):
            def items(self):
                raise RuntimeError("broken")

        result = _safe_serialize_params(BadDict())
        assert result == "{}"


class TestCheckDangerousCommand:
    """Tests for the _check_dangerous_command helper."""

    def test_safe_command_returns_none(self):
        assert _check_dangerous_command("ls -la") is None
        assert _check_dangerous_command("git status") is None
        assert _check_dangerous_command("echo hello") is None

    def test_force_flag_blocked(self):
        result = _check_dangerous_command("git push --force origin main")
        assert result is not None
        assert result["decision"] == "block"

    def test_hard_reset_blocked(self):
        result = _check_dangerous_command("git reset --hard HEAD~1")
        assert result is not None
        assert result["decision"] == "block"

    def test_rm_rf_root_blocked(self):
        result = _check_dangerous_command("rm -rf /")
        assert result is not None
        assert result["decision"] == "block"


class TestHookManagerInit:
    """Tests for HookManager initialization and properties."""

    def test_init_defaults(self):
        mgr = HookManager(session_id="s1", on_event=lambda e: None)
        assert mgr.session_id == "s1"
        assert mgr.current_parent_id is None
        assert mgr.db is None

    def test_current_parent_id_empty_stack(self):
        mgr = HookManager(session_id="s1", on_event=lambda e: None)
        assert mgr.current_parent_id is None


class TestHookManagerPreToolUse:
    """Tests for pre_tool_use hook behavior."""

    def test_regular_tool_emits_tool_start(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        result = mgr.pre_tool_use("s1", "Bash", {
            "tool_use_id": "tu-001",
            "command": "ls",
        })

        assert result is None  # not blocked
        assert len(events) == 1
        assert events[0]["type"] == "tool_start"
        assert events[0]["tool_name"] == "Bash"
        assert events[0]["parent_agent_id"] is None

    def test_agent_tool_pushes_stack(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        mgr.pre_tool_use("s1", "Agent", {
            "tool_use_id": "agent-001",
            "subagent_type": "code_agent",
            "description": "Implement feature",
        })

        assert mgr.current_parent_id == "agent-001"
        assert events[0]["type"] == "agent_start"
        assert events[0]["agent_type"] == "code_agent"

    def test_nested_agents_stack_correctly(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        # Outer agent
        mgr.pre_tool_use("s1", "Agent", {"tool_use_id": "outer"})
        assert mgr.current_parent_id == "outer"

        # Inner agent
        mgr.pre_tool_use("s1", "Agent", {"tool_use_id": "inner"})
        assert mgr.current_parent_id == "inner"

        # Tool inside inner agent gets inner as parent
        mgr.pre_tool_use("s1", "Read", {"tool_use_id": "read-001"})
        assert events[-1]["parent_agent_id"] == "inner"

    def test_dangerous_bash_blocked(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        result = mgr.pre_tool_use("s1", "Bash", {
            "tool_use_id": "tu-002",
            "command": "git push --force origin main",
        })

        assert result is not None
        assert result["decision"] == "block"

    def test_safe_bash_allowed(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        result = mgr.pre_tool_use("s1", "Bash", {
            "tool_use_id": "tu-003",
            "command": "git status",
        })

        assert result is None

    def test_task_tool_treated_as_agent(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        mgr.pre_tool_use("s1", "Task", {"tool_use_id": "task-001"})
        assert mgr.current_parent_id == "task-001"
        assert events[0]["type"] == "agent_start"

    def test_event_callback_error_swallowed(self):
        """Errors in on_event callback should not propagate."""

        def bad_callback(event):
            raise RuntimeError("callback broke")

        mgr = HookManager(session_id="s1", on_event=bad_callback)
        # Should not raise
        result = mgr.pre_tool_use("s1", "Read", {"tool_use_id": "tu-004"})
        assert result is None

    def test_timer_started(self):
        mgr = HookManager(session_id="s1", on_event=lambda e: None)
        mgr.pre_tool_use("s1", "Read", {"tool_use_id": "tu-005"})
        assert "tu-005" in mgr._tool_timers


class TestHookManagerPostToolUse:
    """Tests for post_tool_use hook behavior."""

    def test_regular_tool_emits_tool_complete(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        mgr.pre_tool_use("s1", "Read", {"tool_use_id": "tu-001"})
        mgr.post_tool_use("s1", "Read", {"tool_use_id": "tu-001"}, {})

        assert events[-1]["type"] == "tool_complete"
        assert events[-1]["success"] is True
        assert events[-1]["duration_ms"] is not None

    def test_tool_with_error(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        mgr.pre_tool_use("s1", "Bash", {"tool_use_id": "tu-002", "command": "ls"})
        mgr.post_tool_use("s1", "Bash", {"tool_use_id": "tu-002"}, {"error": "file not found"})

        assert events[-1]["success"] is False
        assert events[-1]["error"] == "file not found"

    def test_agent_tool_pops_stack(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        mgr.pre_tool_use("s1", "Agent", {"tool_use_id": "agent-001"})
        assert mgr.current_parent_id == "agent-001"

        mgr.post_tool_use("s1", "Agent", {"tool_use_id": "agent-001"}, {})
        assert mgr.current_parent_id is None
        assert events[-1]["type"] == "agent_stop"

    def test_nested_agent_pop_preserves_outer(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        mgr.pre_tool_use("s1", "Agent", {"tool_use_id": "outer"})
        mgr.pre_tool_use("s1", "Agent", {"tool_use_id": "inner"})
        assert mgr.current_parent_id == "inner"

        mgr.post_tool_use("s1", "Agent", {"tool_use_id": "inner"}, {})
        assert mgr.current_parent_id == "outer"

        mgr.post_tool_use("s1", "Agent", {"tool_use_id": "outer"}, {})
        assert mgr.current_parent_id is None

    def test_duration_calculated(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        mgr.pre_tool_use("s1", "Read", {"tool_use_id": "tu-010"})
        # Small delay to ensure measurable duration
        import time
        time.sleep(0.01)
        mgr.post_tool_use("s1", "Read", {"tool_use_id": "tu-010"}, {})

        duration = events[-1]["duration_ms"]
        assert duration is not None
        assert duration >= 5  # at least 5ms (conservative)

    def test_db_record_called(self):
        db = MagicMock()
        mgr = HookManager(session_id="s1", on_event=lambda e: None, db=db)

        mgr.pre_tool_use("s1", "Bash", {"tool_use_id": "tu-020", "command": "ls"})
        mgr.post_tool_use("s1", "Bash", {"tool_use_id": "tu-020"}, {})

        db.record_tool_event.assert_called_once()
        call_kwargs = db.record_tool_event.call_args
        assert call_kwargs.kwargs["tool_name"] == "Bash"
        assert call_kwargs.kwargs["success"] is True

    def test_db_error_swallowed(self):
        """Database failures should not propagate."""
        db = MagicMock()
        db.record_tool_event.side_effect = RuntimeError("DB down")

        mgr = HookManager(session_id="s1", on_event=lambda e: None, db=db)
        mgr.pre_tool_use("s1", "Read", {"tool_use_id": "tu-030"})
        # Should not raise
        mgr.post_tool_use("s1", "Read", {"tool_use_id": "tu-030"}, {})

    def test_missing_timer_gives_none_duration(self):
        events = []
        mgr = HookManager(session_id="s1", on_event=events.append)

        # Call post without pre (no timer)
        mgr.post_tool_use("s1", "Read", {"tool_use_id": "no-timer"}, {})
        assert events[-1]["duration_ms"] is None
