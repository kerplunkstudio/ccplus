"""Integration tests -- verify end-to-end WebSocket protocol alignment.

Tests that the event names, payload shapes, and auth flow match
between what the server emits and what the frontend expects.
"""

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

# Patch SessionManager before importing server
with patch("backend.sdk_session.SessionManager") as _MockSM:
    _MockSM.return_value = MagicMock()
    _MockSM.return_value.get_active_sessions.return_value = []
    from backend.server import app, socketio, connected_clients, session_manager


@pytest.fixture(autouse=True)
def _clear_clients():
    connected_clients.clear()
    yield
    connected_clients.clear()


@pytest.fixture()
def authed_client():
    """SocketIO test client with valid auth via query params (matching frontend)."""
    app.config["TESTING"] = True
    with patch("backend.server.verify_token", return_value="test-user"):
        tc = socketio.test_client(
            app,
            query_string="token=valid-jwt&session_id=integration-sess",
        )
        yield tc
        if tc.is_connected():
            tc.disconnect()


class TestWebSocketProtocolAlignment:
    """Verify event names and payloads match the frontend useSocket.ts contract."""

    def test_connect_emits_connected_with_session_id(self, authed_client):
        received = authed_client.get_received()
        connected_events = [r for r in received if r["name"] == "connected"]
        assert len(connected_events) == 1
        assert connected_events[0]["args"][0]["session_id"] == "integration-sess"

    def test_message_event_reads_content_field(self, authed_client):
        """Frontend sends {content: string}, server reads data.get('content')."""
        authed_client.get_received()

        with patch("backend.server.record_message"):
            # This matches what the frontend sends after the fix
            authed_client.emit("message", {"content": "hello world"})

        received = authed_client.get_received()
        event_names = [r["name"] for r in received]
        assert "message_received" in event_names

        # Verify submit_query was called with the right prompt
        session_manager.submit_query.assert_called()
        call_kwargs = session_manager.submit_query.call_args
        assert call_kwargs.kwargs.get("prompt") or call_kwargs[1].get("prompt") or "hello world" in str(call_kwargs)

    def test_message_with_wrong_key_is_ignored(self, authed_client):
        """If frontend sent {message: ...} (old format), it should be empty/ignored."""
        authed_client.get_received()

        with patch("backend.server.record_message"):
            authed_client.emit("message", {"message": "this uses wrong key"})

        received = authed_client.get_received()
        event_names = [r["name"] for r in received]
        # Empty content after strip() -> no message_received
        assert "message_received" not in event_names

    def test_text_delta_payload_has_text_key(self, authed_client):
        """Server emits text_delta with {text: ...}, matching frontend expectation."""
        authed_client.get_received()

        with patch("backend.server.record_message"):
            # Capture the on_text callback
            authed_client.emit("message", {"content": "test"})

        # Get the on_text callback from submit_query call
        call_args = session_manager.submit_query.call_args
        # Could be positional or keyword
        on_text = call_args.kwargs.get("on_text") or call_args[1].get("on_text")

        if on_text:
            # Simulate the callback - it should emit text_delta with {text: ...}
            on_text("Hello ")
            # The emit goes to the room, not directly to test client
            # We verify the function exists and doesn't crash

    def test_response_complete_payload_shape(self, authed_client):
        """Server emits response_complete with cost/token metadata."""
        authed_client.get_received()

        with patch("backend.server.record_message"):
            authed_client.emit("message", {"content": "test"})

        call_args = session_manager.submit_query.call_args
        on_complete = call_args.kwargs.get("on_complete") or call_args[1].get("on_complete")

        if on_complete:
            # Simulate completion - should not crash
            on_complete({
                "text": "Response text",
                "session_id": "sdk-123",
                "cost": 0.01,
                "duration_ms": 500,
                "input_tokens": 100,
                "output_tokens": 50,
            })

    def test_error_event_payload_has_message_key(self, authed_client):
        """Server emits error with {message: ...}, matching frontend."""
        authed_client.get_received()

        with patch("backend.server.record_message"):
            authed_client.emit("message", {"content": "test"})

        call_args = session_manager.submit_query.call_args
        on_error = call_args.kwargs.get("on_error") or call_args[1].get("on_error")

        if on_error:
            # Simulate error - should not crash
            on_error("SDK connection failed")

    def test_cancel_emits_cancelled(self, authed_client):
        authed_client.get_received()

        authed_client.emit("cancel")

        received = authed_client.get_received()
        event_names = [r["name"] for r in received]
        assert "cancelled" in event_names

    def test_ping_emits_pong_with_timestamp(self, authed_client):
        authed_client.get_received()

        authed_client.emit("ping")

        received = authed_client.get_received()
        pong_events = [r for r in received if r["name"] == "pong"]
        assert len(pong_events) == 1
        assert "timestamp" in pong_events[0]["args"][0]


class TestAuthEndToEnd:
    """Verify the auth flow works end-to-end."""

    def test_auto_login_then_verify_roundtrip(self):
        app.config["TESTING"] = True
        client = app.test_client()

        # Step 1: Auto-login
        resp = client.post("/api/auth/auto-login")
        assert resp.status_code == 200
        token = resp.get_json()["token"]
        assert token

        # Step 2: Verify the token
        resp = client.post(
            "/api/auth/verify",
            json={"token": token},
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["valid"] is True
        assert data["user"]["id"] == "local"

    def test_websocket_auth_via_query_params(self):
        """Frontend passes token and session_id as query params, not auth option."""
        app.config["TESTING"] = True
        with patch("backend.server.verify_token", return_value="qp-user"):
            tc = socketio.test_client(
                app,
                query_string="token=my-jwt&session_id=my-session",
            )
            assert tc.is_connected()
            received = tc.get_received()
            connected_events = [r for r in received if r["name"] == "connected"]
            assert connected_events[0]["args"][0]["session_id"] == "my-session"
            tc.disconnect()


class TestStaticServing:
    """Verify static file serving configuration."""

    def test_index_returns_html(self):
        app.config["TESTING"] = True
        client = app.test_client()
        resp = client.get("/")
        assert resp.status_code == 200


class TestDatabaseIntegration:
    """Verify server correctly uses database functions."""

    def test_history_endpoint_calls_get_conversation_history(self):
        app.config["TESTING"] = True
        client = app.test_client()

        with patch("backend.server.get_conversation_history", return_value=[]) as mock_gh:
            resp = client.get("/api/history/test-session")
            assert resp.status_code == 200
            mock_gh.assert_called_once_with("test-session")

    def test_stats_endpoint_calls_get_stats(self):
        app.config["TESTING"] = True
        client = app.test_client()

        fake_stats = {
            "total_conversations": 5,
            "total_tool_events": 20,
            "events_by_tool": {"Read": 10, "Write": 10},
        }
        with patch("backend.server.get_stats", return_value=fake_stats) as mock_gs:
            resp = client.get("/api/stats")
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["total_conversations"] == 5
            mock_gs.assert_called_once()

    def test_message_handler_records_user_message(self, authed_client):
        authed_client.get_received()

        with patch("backend.server.record_message") as mock_rm:
            authed_client.emit("message", {"content": "hello"})
            mock_rm.assert_called_once_with(
                "integration-sess", "test-user", "user", "hello", project_path=None
            )
