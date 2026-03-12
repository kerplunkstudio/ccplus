"""Tests for backend.server -- HTTP routes and WebSocket events."""

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

# Patch sdk_session before importing server so SessionManager doesn't start
# a real asyncio loop during test collection.
with patch("backend.sdk_session.SessionManager") as _MockSM:
    _MockSM.return_value = MagicMock()
    _MockSM.return_value.get_active_sessions.return_value = []
    from backend.server import app, socketio, connected_clients, session_manager


@pytest.fixture(autouse=True)
def _clear_clients():
    """Ensure connected_clients is clean between tests."""
    connected_clients.clear()
    yield
    connected_clients.clear()


@pytest.fixture()
def client():
    """Flask test client."""
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture()
def socketio_client():
    """SocketIO test client with a valid auth token."""
    app.config["TESTING"] = True
    with patch("backend.server.verify_token", return_value="test-user"):
        test_client = socketio.test_client(
            app,
            query_string="token=valid&session_id=sess-1",
        )
        yield test_client
        if test_client.is_connected():
            test_client.disconnect()


# =========================================================================
# HTTP Route Tests
# =========================================================================


class TestHealthEndpoint:
    def test_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert "uptime_seconds" in data
        assert "connected_clients" in data

    def test_includes_db_stats(self, client):
        with patch("backend.server.get_stats", return_value={"total_conversations": 5}):
            resp = client.get("/health")
            data = resp.get_json()
            assert data["db"]["total_conversations"] == 5

    def test_handles_db_error_gracefully(self, client):
        with patch("backend.server.get_stats", side_effect=RuntimeError("db down")):
            resp = client.get("/health")
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["db"] == {}


class TestAutoLogin:
    def test_returns_token_in_local_mode(self, client):
        with patch("backend.server.LOCAL_MODE", True), \
             patch("backend.server.auto_login", return_value="jwt.token.here"):
            resp = client.post("/api/auth/auto-login")
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["token"] == "jwt.token.here"
            assert data["user"]["id"] == "local"

    def test_rejects_when_not_local(self, client):
        with patch("backend.server.LOCAL_MODE", False):
            resp = client.post("/api/auth/auto-login")
            assert resp.status_code == 403

    def test_handles_token_generation_failure(self, client):
        with patch("backend.server.LOCAL_MODE", True), \
             patch("backend.server.auto_login", return_value=None):
            resp = client.post("/api/auth/auto-login")
            assert resp.status_code == 500


class TestModelParameter:
    def test_message_with_model_parameter(self, socketio_client):
        """Verify that model parameter is extracted and passed to submit_query."""
        with patch.object(session_manager, "submit_query") as mock_submit:
            socketio_client.emit("message", {
                "content": "Test message",
                "workspace": "/tmp/test",
                "model": "opus",
            })
            time.sleep(0.1)  # Give it time to process

            # Verify submit_query was called with model parameter
            assert mock_submit.called
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["model"] == "opus"
            assert call_kwargs["prompt"] == "Test message"
            assert call_kwargs["workspace"] == "/tmp/test"

    def test_message_without_model_defaults_to_none(self, socketio_client):
        """Verify that missing model parameter defaults to None."""
        with patch.object(session_manager, "submit_query") as mock_submit:
            socketio_client.emit("message", {
                "content": "Test message",
                "workspace": "/tmp/test",
            })
            time.sleep(0.1)

            assert mock_submit.called
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["model"] is None

    def test_message_with_empty_model_defaults_to_none(self, socketio_client):
        """Verify that empty model string defaults to None."""
        with patch.object(session_manager, "submit_query") as mock_submit:
            socketio_client.emit("message", {
                "content": "Test message",
                "workspace": "/tmp/test",
                "model": "",
            })
            time.sleep(0.1)

            assert mock_submit.called
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["model"] is None


class TestAuthVerify:
    def test_valid_token(self, client):
        with patch("backend.server.verify_token", return_value="user-42"):
            resp = client.post(
                "/api/auth/verify",
                json={"token": "valid-jwt"},
                content_type="application/json",
            )
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["valid"] is True
            assert data["user"]["id"] == "user-42"

    def test_invalid_token(self, client):
        with patch("backend.server.verify_token", return_value=None):
            resp = client.post(
                "/api/auth/verify",
                json={"token": "bad"},
                content_type="application/json",
            )
            assert resp.status_code == 401
            data = resp.get_json()
            assert data["valid"] is False

    def test_missing_body(self, client):
        with patch("backend.server.verify_token", return_value=None):
            resp = client.post("/api/auth/verify")
            assert resp.status_code == 401


class TestHistory:
    def test_returns_messages(self, client):
        fake_messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
        with patch("backend.server.get_conversation_history", return_value=fake_messages):
            resp = client.get("/api/history/sess-1")
            assert resp.status_code == 200
            data = resp.get_json()
            assert len(data["messages"]) == 2

    def test_handles_db_error(self, client):
        with patch("backend.server.get_conversation_history", side_effect=RuntimeError("boom")):
            resp = client.get("/api/history/sess-1")
            assert resp.status_code == 500


class TestActivity:
    def test_returns_events(self, client):
        fake_events = [
            {
                "tool_name": "Bash",
                "tool_use_id": "tu-1",
                "parent_agent_id": None,
                "agent_type": None,
                "success": True,
                "duration_ms": 100.0,
                "timestamp": "2026-03-12 10:00:00",
            },
            {
                "tool_name": "Agent",
                "tool_use_id": "tu-2",
                "parent_agent_id": None,
                "agent_type": "code_agent",
                "success": True,
                "duration_ms": 5000.0,
                "timestamp": "2026-03-12 10:00:01",
            },
        ]
        with patch("backend.server.get_tool_events", return_value=fake_events):
            resp = client.get("/api/activity/sess-1")
            assert resp.status_code == 200
            data = resp.get_json()
            assert len(data["events"]) == 2
            assert data["events"][0]["tool_name"] == "Bash"
            assert data["events"][1]["agent_type"] == "code_agent"

    def test_handles_db_error(self, client):
        with patch("backend.server.get_tool_events", side_effect=RuntimeError("boom")):
            resp = client.get("/api/activity/sess-1")
            assert resp.status_code == 500


class TestStats:
    def test_returns_stats(self, client):
        fake_stats = {"total_conversations": 10, "total_tool_events": 50}
        with patch("backend.server.get_stats", return_value=fake_stats):
            resp = client.get("/api/stats")
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["total_conversations"] == 10

    def test_handles_error(self, client):
        with patch("backend.server.get_stats", side_effect=RuntimeError("boom")):
            resp = client.get("/api/stats")
            assert resp.status_code == 500


# =========================================================================
# WebSocket Tests
# =========================================================================


class TestWebSocketConnect:
    def test_connect_with_valid_token(self):
        app.config["TESTING"] = True
        with patch("backend.server.verify_token", return_value="user-1"):
            test_client = socketio.test_client(
                app,
                query_string="token=valid&session_id=sess-abc",
            )
            assert test_client.is_connected()
            received = test_client.get_received()
            # Should receive 'connected' event
            events = [r["name"] for r in received]
            assert "connected" in events
            test_client.disconnect()

    def test_connect_with_invalid_token(self):
        app.config["TESTING"] = True
        with patch("backend.server.verify_token", return_value=None):
            test_client = socketio.test_client(
                app,
                query_string="token=bad&session_id=sess-abc",
            )
            # Should be disconnected by server
            assert not test_client.is_connected()


class TestWebSocketMessage:
    def test_sends_message_and_gets_ack(self, socketio_client):
        # Clear any connect-time events
        socketio_client.get_received()

        with patch("backend.server.record_message"):
            socketio_client.emit("message", {"content": "hello"})

        received = socketio_client.get_received()
        event_names = [r["name"] for r in received]
        assert "message_received" in event_names

    def test_empty_message_ignored(self, socketio_client):
        socketio_client.get_received()

        socketio_client.emit("message", {"content": ""})

        received = socketio_client.get_received()
        event_names = [r["name"] for r in received]
        assert "message_received" not in event_names

    def test_unauthenticated_message_gets_error(self):
        """A raw client without a connected_clients entry gets an error."""
        app.config["TESTING"] = True
        # Connect without patching verify_token to return None ->
        # actually let's simulate by connecting then removing from dict
        with patch("backend.server.verify_token", return_value="user-x"):
            tc = socketio.test_client(
                app,
                query_string="token=t&session_id=s",
            )
            tc.get_received()

            # Remove from connected_clients to simulate stale state
            connected_clients.clear()

            tc.emit("message", {"content": "test"})
            received = tc.get_received()
            event_names = [r["name"] for r in received]
            assert "error" in event_names
            tc.disconnect()


class TestWebSocketCancel:
    def test_cancel_calls_session_manager(self, socketio_client):
        socketio_client.get_received()

        socketio_client.emit("cancel")

        received = socketio_client.get_received()
        event_names = [r["name"] for r in received]
        assert "cancelled" in event_names
        session_manager.cancel_query.assert_called()


class TestWebSocketPing:
    def test_ping_returns_pong(self, socketio_client):
        socketio_client.get_received()

        socketio_client.emit("ping")

        received = socketio_client.get_received()
        event_names = [r["name"] for r in received]
        assert "pong" in event_names
        pong_data = next(r["args"][0] for r in received if r["name"] == "pong")
        assert "timestamp" in pong_data


class TestWebSocketDisconnect:
    def test_disconnect_cleans_up(self):
        app.config["TESTING"] = True
        with patch("backend.server.verify_token", return_value="user-d"):
            tc = socketio.test_client(
                app,
                query_string="token=t&session_id=sess-d",
            )
            assert tc.is_connected()
            # There should be an entry
            initial_count = len(connected_clients)
            tc.disconnect()
            assert len(connected_clients) < initial_count


class TestStreamingMessagePersistence:
    """Test that assistant messages are recorded when streaming starts (for refresh resilience)."""

    def test_assistant_message_recorded_on_first_text_chunk(self, socketio_client):
        """Verify that the first text_delta triggers an assistant message record."""
        socketio_client.get_received()

        # Mock record_message to track calls
        with patch("backend.server.record_message") as mock_record:
            mock_record.return_value = {"id": 1}
            # Mock session_manager.submit_query to simulate text streaming
            def mock_submit_query(session_id, prompt, workspace, on_text, **kwargs):
                # Immediately call on_text callback to simulate streaming
                on_text("This is the start ")
                on_text("of the response")

            with patch.object(session_manager, "submit_query", side_effect=mock_submit_query):
                socketio_client.emit("message", {"content": "test question"})

            # Verify record_message was called:
            # 1. For the user message (role="user")
            # 2. For the assistant message (role="assistant")
            calls = mock_record.call_args_list
            assert len(calls) >= 2

            # First call should be for user message
            user_call = calls[0]
            assert user_call[0][2] == "user"  # role parameter

            # Second call should be for assistant message with first chunk
            assistant_call = calls[1]
            assert assistant_call[0][2] == "assistant"  # role parameter
            assert "This is the start" in assistant_call[0][3]  # content parameter
