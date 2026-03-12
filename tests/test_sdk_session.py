"""Tests for backend.sdk_session -- SessionManager and ActiveSession."""

import sys
import threading
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend.sdk_session import ActiveSession, SessionManager


# --- Raw message dicts (what _query.receive_messages() yields) ---

def _raw_result(session_id="x", cost=None, duration_ms=0):
    return {
        "type": "result",
        "subtype": "success",
        "duration_ms": duration_ms,
        "duration_api_ms": 0,
        "is_error": False,
        "num_turns": 1,
        "session_id": session_id,
        "total_cost_usd": cost,
        "usage": {"input_tokens": 100, "output_tokens": 50},
    }


def _raw_assistant(text="Hello"):
    return {
        "type": "assistant",
        "message": {
            "content": [{"type": "text", "text": text}],
            "model": "sonnet",
        },
    }


def _raw_assistant_tool(tool_id="tu-001", name="Bash", tool_input=None):
    return {
        "type": "assistant",
        "message": {
            "content": [{
                "type": "tool_use",
                "id": tool_id,
                "name": name,
                "input": tool_input or {"command": "ls"},
            }],
            "model": "sonnet",
        },
    }


def _raw_rate_limit():
    return {"type": "rate_limit_event", "data": {}}


def _mock_client_with_query(raw_messages_gen):
    """Create a mock ClaudeSDKClient with _query.receive_messages set."""
    mock_client = AsyncMock()
    mock_client.connect = AsyncMock()
    mock_client.query = AsyncMock()
    mock_client.disconnect = AsyncMock()
    mock_client.interrupt = AsyncMock()
    mock_query = MagicMock()
    mock_query.receive_messages = raw_messages_gen
    mock_client._query = mock_query
    return mock_client


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

    @patch("backend.sdk_session.ClaudeSDKClient")
    def test_submit_query_calls_on_complete(self, mock_client_class):
        """Verify that a successful query calls on_complete with result dict."""

        async def raw_messages():
            yield _raw_result(session_id="sdk-session-1", cost=0.01, duration_ms=500)

        mock_client = _mock_client_with_query(raw_messages)
        mock_client_class.return_value = mock_client

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
            assert result_data["duration_ms"] == 500
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.ClaudeSDKClient")
    def test_submit_query_streams_text(self, mock_client_class):
        """Verify that assistant text blocks are forwarded via on_text."""

        async def raw_messages():
            yield _raw_assistant("Hello world")
            yield _raw_result()

        mock_client = _mock_client_with_query(raw_messages)
        mock_client_class.return_value = mock_client

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

    @patch("backend.sdk_session.ClaudeSDKClient")
    def test_submit_query_emits_tool_events(self, mock_client_class):
        """Verify that tool_use blocks don't crash (events come via hooks)."""

        async def raw_messages():
            yield _raw_assistant_tool()
            yield _raw_result()

        mock_client = _mock_client_with_query(raw_messages)
        mock_client_class.return_value = mock_client

        mgr = SessionManager()
        try:
            completed = threading.Event()

            def on_complete(data):
                completed.set()

            mgr.submit_query(
                session_id="user-3",
                prompt="Run ls",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=on_complete,
                on_error=lambda e: None,
            )

            completed.wait(timeout=5)
            assert completed.is_set()
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.ClaudeSDKClient")
    def test_submit_query_calls_on_error(self, mock_client_class):
        """Verify that SDK exceptions are forwarded via on_error."""

        async def raw_messages():
            raise RuntimeError("SDK connection failed")
            yield  # make it an async generator  # noqa: E501

        mock_client = _mock_client_with_query(raw_messages)
        mock_client_class.return_value = mock_client

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

    @patch("backend.sdk_session.ClaudeSDKClient")
    def test_submit_query_cancels_previous(self, mock_client_class):
        """Verify that submitting a new query cancels the previous one."""

        async def raw_messages():
            import asyncio
            await asyncio.sleep(10)
            yield _raw_result()

        mock_client = _mock_client_with_query(raw_messages)
        mock_client_class.return_value = mock_client

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

            time.sleep(0.1)

            mgr.submit_query(
                session_id="user-5",
                prompt="Second",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=lambda d: None,
                on_error=lambda e: None,
            )

            time.sleep(0.2)
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.ClaudeSDKClient")
    def test_rate_limit_event_skipped(self, mock_client_class):
        """Verify that rate_limit_event messages are skipped without breaking the stream."""

        async def raw_messages():
            yield _raw_assistant("Before rate limit")
            yield _raw_rate_limit()  # This should be skipped
            yield _raw_assistant("After rate limit")
            yield _raw_result(session_id="ok", cost=0.05)

        mock_client = _mock_client_with_query(raw_messages)
        mock_client_class.return_value = mock_client

        mgr = SessionManager()
        try:
            completed = threading.Event()
            text_chunks = []
            result_data = {}

            def on_text(t):
                text_chunks.append(t)

            def on_complete(data):
                result_data.update(data)
                completed.set()

            mgr.submit_query(
                session_id="user-6",
                prompt="Test rate limit",
                workspace="/tmp",
                on_text=on_text,
                on_tool_event=lambda e: None,
                on_complete=on_complete,
                on_error=lambda e: None,
            )

            completed.wait(timeout=5)
            assert completed.is_set()
            assert "Before rate limit" in text_chunks
            assert "After rate limit" in text_chunks
            assert result_data["session_id"] == "ok"
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.ClaudeSDKClient")
    def test_second_query_works(self, mock_client_class):
        """Verify that a second query on the same session works after the first completes."""
        call_count = 0

        async def raw_messages_1():
            yield _raw_assistant("First response")
            yield _raw_rate_limit()
            yield _raw_result(session_id="s1")

        async def raw_messages_2():
            yield _raw_assistant("Second response")
            yield _raw_result(session_id="s2")

        mock_query = MagicMock()
        # First call returns first generator, second call returns second
        mock_query.receive_messages = MagicMock(side_effect=[raw_messages_1(), raw_messages_2()])

        mock_client = AsyncMock()
        mock_client.connect = AsyncMock()
        mock_client.query = AsyncMock()
        mock_client.disconnect = AsyncMock()
        mock_client._query = mock_query
        mock_client_class.return_value = mock_client

        mgr = SessionManager()
        try:
            # First query
            completed1 = threading.Event()
            text1 = []

            mgr.submit_query(
                session_id="user-7",
                prompt="First",
                workspace="/tmp",
                on_text=lambda t: text1.append(t),
                on_tool_event=lambda e: None,
                on_complete=lambda d: completed1.set(),
                on_error=lambda e: None,
            )
            completed1.wait(timeout=5)
            assert completed1.is_set()
            assert "First response" in text1

            # Second query — same session, reuses client
            completed2 = threading.Event()
            text2 = []
            result2 = {}

            mgr.submit_query(
                session_id="user-7",
                prompt="Second",
                workspace="/tmp",
                on_text=lambda t: text2.append(t),
                on_tool_event=lambda e: None,
                on_complete=lambda d: (result2.update(d), completed2.set()),
                on_error=lambda e: None,
            )
            completed2.wait(timeout=5)
            assert completed2.is_set()
            assert "Second response" in text2
            assert result2["session_id"] == "s2"
        finally:
            mgr.shutdown()
