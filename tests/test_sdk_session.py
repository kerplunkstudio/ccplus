"""Tests for backend.sdk_session -- SessionManager (worker proxy)."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend.sdk_session import SessionManager


@pytest.fixture
def mgr():
    """Create a SessionManager with a mocked WorkerClient."""
    with patch("backend.sdk_session.WorkerClient") as mock_client_class:
        mock_client = MagicMock()
        mock_client.connected = True
        mock_client_class.return_value = mock_client
        manager = SessionManager()
        manager._mock_client = mock_client
        yield manager


class TestSessionManagerLifecycle:
    """Tests for SessionManager init and state queries."""

    def test_init_connects_to_worker(self, mgr):
        mgr._mock_client.connect.assert_called_once()

    def test_get_active_sessions_empty(self, mgr):
        assert mgr.get_active_sessions() == []

    def test_is_active_false_for_unknown(self, mgr):
        assert mgr.is_active("nonexistent") is False

    def test_worker_connected_property(self, mgr):
        assert mgr.worker_connected is True

    def test_shutdown_disconnects_client(self, mgr):
        mgr.shutdown()
        mgr._mock_client.disconnect.assert_called_once()


class TestSubmitQuery:
    """Tests for submit_query callback registration."""

    def test_submit_registers_callbacks(self, mgr):
        on_text = MagicMock()
        on_tool = MagicMock()
        on_complete = MagicMock()
        on_error = MagicMock()

        mgr.submit_query(
            session_id="s1",
            prompt="Hello",
            workspace="/tmp",
            on_text=on_text,
            on_tool_event=on_tool,
            on_complete=on_complete,
            on_error=on_error,
        )

        assert "s1" in mgr._callbacks
        assert mgr.is_active("s1")
        mgr._mock_client.submit_query.assert_called_once_with("s1", "Hello", "/tmp", None, None)

    def test_submit_with_model(self, mgr):
        mgr.submit_query(
            session_id="s2",
            prompt="Hi",
            workspace="/tmp",
            on_text=MagicMock(),
            on_tool_event=MagicMock(),
            on_complete=MagicMock(),
            on_error=MagicMock(),
            model="opus",
        )
        mgr._mock_client.submit_query.assert_called_once_with("s2", "Hi", "/tmp", "opus", None)

    def test_submit_with_user_question_callback(self, mgr):
        on_question = MagicMock()
        mgr.submit_query(
            session_id="s3",
            prompt="Test",
            workspace="/tmp",
            on_text=MagicMock(),
            on_tool_event=MagicMock(),
            on_complete=MagicMock(),
            on_error=MagicMock(),
            on_user_question=on_question,
        )
        assert mgr._callbacks["s3"]["on_user_question"] == on_question


class TestCallbackDispatch:
    """Tests for event handler dispatch to registered callbacks."""

    def _register(self, mgr, session_id="s1"):
        cbs = {
            "on_text": MagicMock(),
            "on_tool_event": MagicMock(),
            "on_complete": MagicMock(),
            "on_error": MagicMock(),
            "on_user_question": MagicMock(),
        }
        mgr.submit_query(
            session_id=session_id,
            prompt="test",
            workspace="/tmp",
            on_text=cbs["on_text"],
            on_tool_event=cbs["on_tool_event"],
            on_complete=cbs["on_complete"],
            on_error=cbs["on_error"],
            on_user_question=cbs["on_user_question"],
        )
        return cbs

    def test_text_delta_dispatched(self, mgr):
        cbs = self._register(mgr)
        mgr._handle_text_delta("s1", "hello")
        cbs["on_text"].assert_called_once_with("hello")

    def test_tool_event_dispatched(self, mgr):
        cbs = self._register(mgr)
        event = {"type": "tool_start", "tool_name": "Bash"}
        mgr._handle_tool_event("s1", event)
        cbs["on_tool_event"].assert_called_once_with(event)

    def test_error_dispatched(self, mgr):
        cbs = self._register(mgr)
        mgr._handle_error("s1", "something broke")
        cbs["on_error"].assert_called_once_with("something broke")
        # Error removes from active
        assert not mgr.is_active("s1")

    def test_response_complete_with_sdk_session_id_removes_active(self, mgr):
        cbs = self._register(mgr)
        mgr._handle_response_complete("s1", {"sdk_session_id": "sdk-123", "cost": 0.01})
        cbs["on_complete"].assert_called_once()
        assert not mgr.is_active("s1")

    def test_response_complete_without_sdk_session_id_keeps_active(self, mgr):
        cbs = self._register(mgr)
        mgr._handle_response_complete("s1", {"text": "partial"})
        cbs["on_complete"].assert_called_once()
        assert mgr.is_active("s1")

    def test_user_question_dispatched(self, mgr):
        cbs = self._register(mgr)
        data = {"questions": [{"question": "Which?"}], "tool_use_id": "tu1"}
        mgr._handle_user_question("s1", data)
        cbs["on_user_question"].assert_called_once_with(data)

    def test_dispatch_to_unknown_session_is_noop(self, mgr):
        # Should not raise
        mgr._handle_text_delta("unknown", "text")
        mgr._handle_tool_event("unknown", {})
        mgr._handle_response_complete("unknown", {})
        mgr._handle_error("unknown", "err")
        mgr._handle_user_question("unknown", {})

    def test_callback_exception_does_not_propagate(self, mgr):
        cbs = self._register(mgr)
        cbs["on_text"].side_effect = RuntimeError("boom")
        # Should not raise
        mgr._handle_text_delta("s1", "hello")


class TestSessionStatus:
    """Tests for _handle_session_status and reconnect callbacks."""

    def test_session_status_updates_active_sessions(self, mgr):
        sessions = [
            {"session_id": "s1", "query_active": True},
            {"session_id": "s2", "query_active": False},
            {"session_id": "s3", "query_active": True},
        ]
        mgr._handle_session_status(sessions)
        assert mgr.is_active("s1")
        assert not mgr.is_active("s2")
        assert mgr.is_active("s3")

    def test_session_status_calls_reconnect_callback(self, mgr):
        reconnect_cb = MagicMock()
        mgr.on_session_reconnect = reconnect_cb

        sessions = [
            {"session_id": "s1", "query_active": True},
            {"session_id": "s2", "query_active": False},
        ]
        mgr._handle_session_status(sessions)
        reconnect_cb.assert_called_once_with("s1")

    def test_session_status_no_reconnect_callback(self, mgr):
        # Should not raise when on_session_reconnect is None
        mgr._handle_session_status([{"session_id": "s1", "query_active": True}])

    def test_reconnect_callback_exception_handled(self, mgr):
        reconnect_cb = MagicMock(side_effect=RuntimeError("reconnect failed"))
        mgr.on_session_reconnect = reconnect_cb
        # Should not raise
        mgr._handle_session_status([{"session_id": "s1", "query_active": True}])

    def test_session_status_detects_lost_sessions(self, mgr):
        """Test that lost sessions are detected when worker restarts."""
        lost_cb = MagicMock()
        mgr.on_session_lost = lost_cb

        # First status: two active sessions
        sessions1 = [
            {"session_id": "s1", "query_active": True},
            {"session_id": "s2", "query_active": True},
        ]
        mgr._handle_session_status(sessions1)
        lost_cb.assert_not_called()  # First status, no lost sessions yet

        # Second status: only s1 active (s2 lost)
        sessions2 = [
            {"session_id": "s1", "query_active": True},
        ]
        mgr._handle_session_status(sessions2)
        lost_cb.assert_called_once_with("s2")

    def test_session_status_no_lost_callback(self, mgr):
        """Test that missing lost callback doesn't cause errors."""
        # First status
        mgr._handle_session_status([{"session_id": "s1", "query_active": True}])
        # Second status with lost session
        mgr._handle_session_status([])
        # Should not raise

    def test_lost_callback_exception_handled(self, mgr):
        """Test that exceptions in lost callback are handled gracefully."""
        lost_cb = MagicMock(side_effect=RuntimeError("lost failed"))
        mgr.on_session_lost = lost_cb

        # First status
        mgr._handle_session_status([{"session_id": "s1", "query_active": True}])
        # Second status with lost session (should handle exception)
        mgr._handle_session_status([])
        # Should not raise


class TestRegisterStreamingCallbacks:
    """Tests for register_streaming_callbacks (post-restart recovery)."""

    def test_register_adds_to_active(self, mgr):
        mgr.register_streaming_callbacks(
            "s1",
            on_text=MagicMock(),
            on_tool_event=MagicMock(),
            on_complete=MagicMock(),
            on_error=MagicMock(),
        )
        assert mgr.is_active("s1")
        assert "s1" in mgr._callbacks

    def test_register_replaces_existing_callbacks(self, mgr):
        cb1 = MagicMock()
        cb2 = MagicMock()
        mgr.register_streaming_callbacks("s1", cb1, MagicMock(), MagicMock(), MagicMock())
        mgr.register_streaming_callbacks("s1", cb2, MagicMock(), MagicMock(), MagicMock())
        mgr._handle_text_delta("s1", "test")
        cb2.assert_called_once_with("test")
        cb1.assert_not_called()


class TestCancelAndDisconnect:
    """Tests for cancel_query and disconnect_session."""

    def test_cancel_forwards_to_client(self, mgr):
        mgr.cancel_query("s1")
        mgr._mock_client.cancel_query.assert_called_once_with("s1")

    def test_disconnect_cleans_up(self, mgr):
        mgr.submit_query(
            "s1", "test", "/tmp",
            MagicMock(), MagicMock(), MagicMock(), MagicMock(),
        )
        assert mgr.is_active("s1")
        mgr.disconnect_session("s1")
        assert not mgr.is_active("s1")
        assert "s1" not in mgr._callbacks
        mgr._mock_client.disconnect_session.assert_called_once_with("s1")

    def test_send_question_response_forwards(self, mgr):
        mgr.send_question_response("s1", "Option A")
        mgr._mock_client.send_question_response.assert_called_once_with("s1", "Option A")
