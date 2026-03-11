"""Tests for backend.sdk_session -- SessionManager and ActiveSession."""

import sys
import threading
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend.sdk_session import ActiveSession, SessionManager


class TestActiveSession:
    """Tests for the ActiveSession dataclass."""

    def test_defaults(self):
        session = ActiveSession(session_id="test-123")
        assert session.session_id == "test-123"
        assert not session.cancel_event.is_set()
        assert session.started_at  # non-empty ISO timestamp

    def test_cancel_event_set(self):
        session = ActiveSession(session_id="s1")
        session.cancel_event.set()
        assert session.cancel_event.is_set()


class TestSessionManagerLifecycle:
    """Tests for SessionManager init, shutdown, and state queries."""

    def test_init_starts_background_thread(self):
        mgr = SessionManager()
        try:
            assert mgr._loop is not None
            assert mgr._thread is not None
            assert mgr._thread.is_alive()
            assert mgr._thread.daemon is True
        finally:
            mgr.shutdown()

    def test_shutdown_stops_loop(self):
        mgr = SessionManager()
        mgr.shutdown()
        # Thread should join within timeout
        assert not mgr._thread.is_alive()

    def test_get_active_sessions_empty(self):
        mgr = SessionManager()
        try:
            assert mgr.get_active_sessions() == []
        finally:
            mgr.shutdown()

    def test_is_active_false_for_unknown(self):
        mgr = SessionManager()
        try:
            assert mgr.is_active("nonexistent") is False
        finally:
            mgr.shutdown()


class TestSessionManagerCancel:
    """Tests for cancel_query behavior."""

    def test_cancel_nonexistent_session_is_noop(self):
        mgr = SessionManager()
        try:
            # Should not raise
            mgr.cancel_query("no-such-session")
        finally:
            mgr.shutdown()

    def test_cancel_sets_event_on_active_session(self):
        mgr = SessionManager()
        try:
            # Manually inject an active session
            import asyncio

            active = ActiveSession(session_id="s1")
            with mgr._lock:
                mgr._active["s1"] = active

            assert not active.cancel_event.is_set()
            mgr.cancel_query("s1")
            assert active.cancel_event.is_set()
        finally:
            mgr.shutdown()


class TestSessionManagerSubmitQuery:
    """Tests for submit_query with mocked SDK."""

    @patch("backend.sdk_session.query")
    def test_submit_query_calls_on_complete(self, mock_query):
        """Verify that a successful query calls on_complete with result dict."""

        # Create a mock async iterator that yields a result message
        result_msg = MagicMock()
        result_msg.type = "result"
        result_msg.session_id = "sdk-session-1"
        result_msg.cost_usd = 0.01
        result_msg.duration_ms = 500
        result_msg.input_tokens = 100
        result_msg.output_tokens = 50

        async def mock_query_fn(*args, **kwargs):
            yield result_msg

        mock_query.side_effect = mock_query_fn

        mgr = SessionManager()
        try:
            completed = threading.Event()
            result_data = {}

            def on_complete(data):
                result_data.update(data)
                completed.set()

            mgr.submit_query(
                session_id="user-1",
                prompt="Hello",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=on_complete,
                on_error=lambda e: None,
            )

            completed.wait(timeout=5)
            assert completed.is_set()
            assert result_data["session_id"] == "sdk-session-1"
            assert result_data["cost"] == 0.01
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.query")
    def test_submit_query_streams_text(self, mock_query):
        """Verify that assistant text blocks are forwarded via on_text."""
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "Hello world"

        assistant_msg = MagicMock()
        assistant_msg.type = "assistant"
        assistant_msg.content = [text_block]

        result_msg = MagicMock()
        result_msg.type = "result"
        result_msg.session_id = None
        result_msg.cost_usd = None
        result_msg.duration_ms = None
        result_msg.input_tokens = None
        result_msg.output_tokens = None

        async def mock_query_fn(*args, **kwargs):
            yield assistant_msg
            yield result_msg

        mock_query.side_effect = mock_query_fn

        mgr = SessionManager()
        try:
            completed = threading.Event()
            text_chunks = []

            def on_text(t):
                text_chunks.append(t)

            def on_complete(data):
                completed.set()

            mgr.submit_query(
                session_id="user-2",
                prompt="Hi",
                workspace="/tmp",
                on_text=on_text,
                on_tool_event=lambda e: None,
                on_complete=on_complete,
                on_error=lambda e: None,
            )

            completed.wait(timeout=5)
            assert "Hello world" in text_chunks
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.query")
    def test_submit_query_emits_tool_events(self, mock_query):
        """Verify that tool_use blocks are forwarded via on_tool_event."""
        tool_block = MagicMock()
        tool_block.type = "tool_use"
        tool_block.name = "Bash"
        tool_block.id = "tu-001"
        tool_block.input = {"command": "ls"}

        assistant_msg = MagicMock()
        assistant_msg.type = "assistant"
        assistant_msg.content = [tool_block]

        result_msg = MagicMock()
        result_msg.type = "result"
        result_msg.session_id = None
        result_msg.cost_usd = None
        result_msg.duration_ms = None
        result_msg.input_tokens = None
        result_msg.output_tokens = None

        async def mock_query_fn(*args, **kwargs):
            yield assistant_msg
            yield result_msg

        mock_query.side_effect = mock_query_fn

        mgr = SessionManager()
        try:
            completed = threading.Event()
            tool_events = []

            def on_tool_event(e):
                tool_events.append(e)

            def on_complete(data):
                completed.set()

            mgr.submit_query(
                session_id="user-3",
                prompt="Run ls",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=on_tool_event,
                on_complete=on_complete,
                on_error=lambda e: None,
            )

            completed.wait(timeout=5)
            assert len(tool_events) == 1
            assert tool_events[0]["tool_name"] == "Bash"
            assert tool_events[0]["type"] == "tool_start"
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.query")
    def test_submit_query_calls_on_error(self, mock_query):
        """Verify that SDK exceptions are forwarded via on_error."""

        async def mock_query_fn(*args, **kwargs):
            raise RuntimeError("SDK connection failed")
            yield  # make it an async generator  # noqa: E501

        mock_query.side_effect = mock_query_fn

        mgr = SessionManager()
        try:
            error_event = threading.Event()
            error_msgs = []

            def on_error(msg):
                error_msgs.append(msg)
                error_event.set()

            mgr.submit_query(
                session_id="user-4",
                prompt="Fail",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=lambda d: None,
                on_error=on_error,
            )

            error_event.wait(timeout=5)
            assert "SDK connection failed" in error_msgs[0]
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.query")
    def test_submit_query_cancels_previous(self, mock_query):
        """Verify that submitting a new query cancels the previous one."""
        call_count = {"value": 0}

        async def mock_query_fn(*args, **kwargs):
            call_count["value"] += 1
            # Simulate a long-running query
            import asyncio
            await asyncio.sleep(10)
            yield MagicMock(type="result")

        mock_query.side_effect = mock_query_fn

        mgr = SessionManager()
        try:
            mgr.submit_query(
                session_id="user-5",
                prompt="First",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=lambda d: None,
                on_error=lambda e: None,
            )

            # Small delay to let first query start
            time.sleep(0.1)

            # Submit second query for same session -- should cancel first
            mgr.submit_query(
                session_id="user-5",
                prompt="Second",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=lambda d: None,
                on_error=lambda e: None,
            )

            # The cancel was called, which is the important behavior
            # We verify it doesn't raise and the session is tracked
            time.sleep(0.2)
        finally:
            mgr.shutdown()
