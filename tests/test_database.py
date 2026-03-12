import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import os
import tempfile
import threading

import pytest

# Override DATABASE_PATH before importing database module
_tmp_dir = tempfile.mkdtemp()
os.environ.setdefault("_CCPLUS_TEST_DB", "1")

import backend.config as config

config.DATABASE_PATH = os.path.join(_tmp_dir, "test_ccplus.db")

import backend.database as db


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    """Use a fresh database for each test."""
    test_db = str(tmp_path / "test.db")
    config.DATABASE_PATH = test_db
    # Clear thread-local connection so it reconnects
    if hasattr(db._local, "connection"):
        try:
            db._local.connection.close()
        except Exception:
            pass
        del db._local.connection


class TestRecordMessage:
    def test_insert_and_return(self, fresh_db):
        result = db.record_message("sess1", "user1", "user", "hello")
        assert result["session_id"] == "sess1"
        assert result["user_id"] == "user1"
        assert result["role"] == "user"
        assert result["content"] == "hello"
        assert result["id"] is not None
        assert result["timestamp"] is not None

    def test_sdk_session_id_optional(self, fresh_db):
        result = db.record_message("sess1", "user1", "assistant", "hi", sdk_session_id="sdk-123")
        assert result["sdk_session_id"] == "sdk-123"

    def test_sdk_session_id_default_none(self, fresh_db):
        result = db.record_message("sess1", "user1", "user", "test")
        assert result["sdk_session_id"] is None


class TestGetConversationHistory:
    def test_empty_session(self, fresh_db):
        history = db.get_conversation_history("nonexistent")
        assert history == []

    def test_returns_ordered_messages(self, fresh_db):
        db.record_message("sess1", "user1", "user", "first")
        db.record_message("sess1", "user1", "assistant", "second")
        db.record_message("sess1", "user1", "user", "third")

        history = db.get_conversation_history("sess1")
        assert len(history) == 3
        assert history[0]["content"] == "first"
        assert history[2]["content"] == "third"

    def test_respects_limit(self, fresh_db):
        for i in range(10):
            db.record_message("sess1", "user1", "user", f"msg {i}")

        history = db.get_conversation_history("sess1", limit=3)
        assert len(history) == 3

    def test_session_isolation(self, fresh_db):
        db.record_message("sess1", "user1", "user", "session 1")
        db.record_message("sess2", "user1", "user", "session 2")

        history = db.get_conversation_history("sess1")
        assert len(history) == 1
        assert history[0]["content"] == "session 1"


class TestRecordToolEvent:
    def test_insert_minimal(self, fresh_db):
        result = db.record_tool_event("sess1", "Read", "tool-1")
        assert result["session_id"] == "sess1"
        assert result["tool_name"] == "Read"
        assert result["tool_use_id"] == "tool-1"
        assert result["success"] is None
        assert result["error"] is None

    def test_insert_full(self, fresh_db):
        result = db.record_tool_event(
            session_id="sess1",
            tool_name="Write",
            tool_use_id="tool-2",
            parent_agent_id="agent-1",
            agent_type="code_agent",
            success=True,
            error=None,
            duration_ms=150.5,
            parameters={"file_path": "/tmp/test.py"},
            input_tokens=100,
            output_tokens=50,
        )
        assert result["success"] == 1  # SQLite stores bool as int
        assert result["duration_ms"] == 150.5
        assert result["parent_agent_id"] == "agent-1"
        assert result["input_tokens"] == 100

    def test_error_event(self, fresh_db):
        result = db.record_tool_event(
            "sess1", "Bash", "tool-3", success=False, error="Permission denied"
        )
        assert result["success"] == 0
        assert result["error"] == "Permission denied"


class TestGetToolEvents:
    def test_empty(self, fresh_db):
        events = db.get_tool_events("nonexistent")
        assert events == []

    def test_returns_ordered_events(self, fresh_db):
        db.record_tool_event("sess1", "Read", "t1")
        db.record_tool_event("sess1", "Write", "t2")
        db.record_tool_event("sess1", "Bash", "t3")

        events = db.get_tool_events("sess1")
        assert len(events) == 3
        assert events[0]["tool_name"] == "Read"
        assert events[2]["tool_name"] == "Bash"

    def test_deserializes_parameters(self, fresh_db):
        db.record_tool_event(
            "sess1", "Read", "t1", parameters={"file_path": "/tmp/x.py"}
        )
        events = db.get_tool_events("sess1")
        assert events[0]["parameters"] == {"file_path": "/tmp/x.py"}

    def test_respects_limit(self, fresh_db):
        for i in range(10):
            db.record_tool_event("sess1", "Read", f"t{i}")

        events = db.get_tool_events("sess1", limit=5)
        assert len(events) == 5


class TestGetStats:
    def test_empty_stats(self, fresh_db):
        stats = db.get_stats()
        assert stats["total_conversations"] == 0
        assert stats["total_tool_events"] == 0
        assert stats["events_by_tool"] == {}

    def test_populated_stats(self, fresh_db):
        db.record_message("sess1", "user1", "user", "hello")
        db.record_message("sess1", "user1", "assistant", "hi")
        db.record_tool_event("sess1", "Read", "t1")
        db.record_tool_event("sess1", "Read", "t2")
        db.record_tool_event("sess1", "Write", "t3")

        stats = db.get_stats()
        assert stats["total_conversations"] == 2
        assert stats["total_tool_events"] == 3
        assert stats["events_by_tool"]["Read"] == 2
        assert stats["events_by_tool"]["Write"] == 1


class TestGetSessionsList:
    def test_empty_sessions(self, fresh_db):
        sessions = db.get_sessions_list()
        assert sessions == []

    def test_returns_sessions_ordered_by_last_activity(self, fresh_db):
        # Create messages in different sessions
        db.record_message("sess1", "user1", "user", "first message")
        db.record_message("sess2", "user1", "user", "second message")
        db.record_message("sess1", "user1", "assistant", "response")

        sessions = db.get_sessions_list()
        assert len(sessions) == 2
        # sess1 should be first (most recent activity)
        assert sessions[0]["session_id"] == "sess1"
        assert sessions[1]["session_id"] == "sess2"

    def test_includes_message_count(self, fresh_db):
        db.record_message("sess1", "user1", "user", "msg1")
        db.record_message("sess1", "user1", "assistant", "msg2")
        db.record_message("sess1", "user1", "user", "msg3")

        sessions = db.get_sessions_list()
        assert sessions[0]["message_count"] == 3

    def test_includes_last_user_message(self, fresh_db):
        db.record_message("sess1", "user1", "user", "first")
        db.record_message("sess1", "user1", "assistant", "response")
        db.record_message("sess1", "user1", "user", "latest user message")

        sessions = db.get_sessions_list()
        assert sessions[0]["last_user_message"] == "latest user message"

    def test_truncates_long_messages(self, fresh_db):
        long_message = "x" * 100
        db.record_message("sess1", "user1", "user", long_message)

        sessions = db.get_sessions_list()
        assert len(sessions[0]["last_user_message"]) == 83  # 80 chars + "..."
        assert sessions[0]["last_user_message"].endswith("...")

    def test_respects_limit(self, fresh_db):
        for i in range(10):
            db.record_message(f"sess{i}", "user1", "user", f"message {i}")

        sessions = db.get_sessions_list(limit=5)
        assert len(sessions) == 5


class TestImmutability:
    def test_record_message_returns_new_dict(self, fresh_db):
        result = db.record_message("sess1", "user1", "user", "hello")
        result["content"] = "mutated"
        history = db.get_conversation_history("sess1")
        assert history[0]["content"] == "hello"

    def test_get_history_returns_new_list(self, fresh_db):
        db.record_message("sess1", "user1", "user", "hello")
        history1 = db.get_conversation_history("sess1")
        history2 = db.get_conversation_history("sess1")
        assert history1 is not history2
