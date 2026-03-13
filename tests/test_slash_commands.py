"""Tests for slash command handling via SDK."""

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

# Patch sdk_session before importing server
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


class TestSlashCommandPassthrough:
    """Test that slash commands are passed to SDK instead of being executed separately."""

    def test_slash_command_sent_to_sdk(self, socketio_client):
        """Verify slash commands are sent directly to SDK without interception."""
        with patch.object(session_manager, "submit_query") as mock_submit:
            socketio_client.emit("message", {
                "content": "/polish src/app.py",
                "workspace": "/tmp/test",
            })
            time.sleep(0.1)

            # Verify the slash command was sent to SDK as-is
            assert mock_submit.called
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["prompt"] == "/polish src/app.py"
            assert call_kwargs["workspace"] == "/tmp/test"

    def test_critique_slash_command_sent_to_sdk(self, socketio_client):
        """Verify /critique is sent to SDK."""
        with patch.object(session_manager, "submit_query") as mock_submit:
            socketio_client.emit("message", {
                "content": "/critique",
            })
            time.sleep(0.1)

            assert mock_submit.called
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["prompt"] == "/critique"

    def test_custom_skill_sent_to_sdk(self, socketio_client):
        """Verify custom plugin skills are sent to SDK."""
        with patch.object(session_manager, "submit_query") as mock_submit:
            socketio_client.emit("message", {
                "content": "/my-custom-skill arg1 arg2",
            })
            time.sleep(0.1)

            assert mock_submit.called
            call_kwargs = mock_submit.call_args[1]
            assert call_kwargs["prompt"] == "/my-custom-skill arg1 arg2"

    def test_slash_command_with_multiline_args(self, socketio_client):
        """Verify slash commands with multiline arguments work."""
        with patch.object(session_manager, "submit_query") as mock_submit:
            socketio_client.emit("message", {
                "content": "/polish\nfix the formatting\nand add comments",
            })
            time.sleep(0.1)

            assert mock_submit.called
            call_kwargs = mock_submit.call_args[1]
            assert "/polish" in call_kwargs["prompt"]
            assert "fix the formatting" in call_kwargs["prompt"]


class TestSkillExecuteEndpointDeprecated:
    """Test that the /api/skills/execute endpoint is deprecated."""

    def test_execute_endpoint_returns_deprecated(self, client):
        """Verify /api/skills/execute returns 410 Gone with deprecation message."""
        resp = client.post(
            "/api/skills/execute",
            json={
                "skill": "polish",
                "arguments": "src/app.py",
            },
            content_type="application/json",
        )

        assert resp.status_code == 410  # Gone
        data = resp.get_json()
        assert data["deprecated"] is True
        assert "slash commands" in data["error"].lower()

    def test_execute_endpoint_without_body(self, client):
        """Verify deprecated endpoint handles missing body."""
        resp = client.post("/api/skills/execute")
        assert resp.status_code == 410
        data = resp.get_json()
        assert data["deprecated"] is True


class TestSkillListEndpointStillWorks:
    """Test that the /api/skills endpoint still works for autocomplete."""

    def test_get_skills_returns_list(self, client):
        """Verify /api/skills endpoint still works for autocomplete."""
        fake_skills = [
            {"name": "polish", "plugin": "code-quality"},
            {"name": "critique", "plugin": "code-review"},
        ]

        with patch("backend.server.plugin_manager") as mock_pm:
            mock_pm.get_all_skills.return_value = {
                "success": True,
                "skills": fake_skills,
            }

            resp = client.get("/api/skills")
            assert resp.status_code == 200
            data = resp.get_json()
            assert len(data["skills"]) == 2
            assert data["skills"][0]["name"] == "polish"

    def test_get_skills_handles_error(self, client):
        """Verify skill list endpoint handles errors gracefully."""
        with patch("backend.server.plugin_manager") as mock_pm:
            mock_pm.get_all_skills.return_value = {
                "success": False,
                "error": "Plugin system unavailable",
            }

            resp = client.get("/api/skills")
            assert resp.status_code == 500
            data = resp.get_json()
            assert "error" in data
