"""
Integration tests for workspace persistence API endpoints.

Tests the HTTP API routes for workspace state synchronization.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend import database
from backend.server import app


@pytest.fixture
def client():
    """Flask test client."""
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


class TestWorkspaceAPI:
    """Test workspace persistence API endpoints."""

    def test_get_workspace_no_data(self, client):
        """GET /api/workspace returns empty state when no data exists."""
        # Clear any existing state
        database.save_workspace_state("local", {"projects": [], "activeProjectPath": None})

        response = client.get("/api/workspace")
        assert response.status_code == 200

        data = json.loads(response.data)
        assert "projects" in data
        assert "activeProjectPath" in data
        assert data["projects"] == []
        assert data["activeProjectPath"] is None

    def test_save_and_get_workspace(self, client):
        """PUT /api/workspace persists state and GET retrieves it."""
        test_state = {
            "projects": [
                {
                    "path": "/test/project",
                    "name": "Test Project",
                    "tabs": [
                        {
                            "sessionId": "session_abc",
                            "label": "Test Session",
                            "isStreaming": False,
                            "hasRunningAgent": False,
                            "createdAt": 1234567890,
                        }
                    ],
                    "activeTabId": "session_abc",
                }
            ],
            "activeProjectPath": "/test/project",
        }

        # Save state
        response = client.put(
            "/api/workspace",
            data=json.dumps(test_state),
            content_type="application/json",
        )
        assert response.status_code == 200
        save_data = json.loads(response.data)
        assert save_data["status"] == "ok"

        # Retrieve state
        response = client.get("/api/workspace")
        assert response.status_code == 200

        retrieved = json.loads(response.data)
        assert retrieved == test_state

    def test_put_workspace_no_body(self, client):
        """PUT /api/workspace returns error when no state provided."""
        response = client.put("/api/workspace", content_type="application/json")
        # Returns 415 when no body or 400 when empty body depending on Flask version
        assert response.status_code in [400, 415]

    def test_put_workspace_empty_body(self, client):
        """PUT /api/workspace returns 400 for empty JSON."""
        response = client.put(
            "/api/workspace",
            data=json.dumps(None),
            content_type="application/json",
        )
        assert response.status_code == 400

    def test_workspace_persistence_across_requests(self, client):
        """Workspace state persists across multiple requests."""
        state1 = {
            "projects": [{"path": "/p1", "name": "P1", "tabs": [], "activeTabId": None}],
            "activeProjectPath": "/p1",
        }

        # First save
        client.put(
            "/api/workspace",
            data=json.dumps(state1),
            content_type="application/json",
        )

        # Verify first save
        response = client.get("/api/workspace")
        assert json.loads(response.data)["activeProjectPath"] == "/p1"

        # Update to state2
        state2 = {
            "projects": [
                {"path": "/p1", "name": "P1", "tabs": [], "activeTabId": None},
                {"path": "/p2", "name": "P2", "tabs": [], "activeTabId": None},
            ],
            "activeProjectPath": "/p2",
        }

        client.put(
            "/api/workspace",
            data=json.dumps(state2),
            content_type="application/json",
        )

        # Verify update
        response = client.get("/api/workspace")
        retrieved = json.loads(response.data)
        assert retrieved["activeProjectPath"] == "/p2"
        assert len(retrieved["projects"]) == 2

    def test_workspace_with_complex_state(self, client):
        """API handles complex workspace state with multiple projects and tabs."""
        complex_state = {
            "projects": [
                {
                    "path": "/Users/test/ccplus",
                    "name": "ccplus",
                    "tabs": [
                        {
                            "sessionId": "session_1",
                            "label": "Main work",
                            "isStreaming": False,
                            "hasRunningAgent": False,
                            "createdAt": 1000000,
                        },
                        {
                            "sessionId": "session_2",
                            "label": "Testing",
                            "isStreaming": True,
                            "hasRunningAgent": True,
                            "createdAt": 2000000,
                        },
                    ],
                    "activeTabId": "session_1",
                },
                {
                    "path": "/Users/test/other",
                    "name": "other",
                    "tabs": [
                        {
                            "sessionId": "session_3",
                            "label": "Exploration",
                            "isStreaming": False,
                            "hasRunningAgent": False,
                            "createdAt": 3000000,
                        }
                    ],
                    "activeTabId": "session_3",
                },
            ],
            "activeProjectPath": "/Users/test/ccplus",
        }

        # Save complex state
        response = client.put(
            "/api/workspace",
            data=json.dumps(complex_state),
            content_type="application/json",
        )
        assert response.status_code == 200

        # Retrieve and verify
        response = client.get("/api/workspace")
        retrieved = json.loads(response.data)

        assert len(retrieved["projects"]) == 2
        assert len(retrieved["projects"][0]["tabs"]) == 2
        assert retrieved["projects"][0]["tabs"][1]["isStreaming"] is True
        assert retrieved["projects"][0]["tabs"][1]["hasRunningAgent"] is True

    def test_workspace_content_type_header(self, client):
        """PUT /api/workspace requires Content-Type: application/json."""
        test_state = {"projects": [], "activeProjectPath": None}

        # Without content-type header (returns 415 Unsupported Media Type)
        response = client.put(
            "/api/workspace",
            data=json.dumps(test_state),
        )
        assert response.status_code == 415

        # With explicit content-type (should succeed)
        response = client.put(
            "/api/workspace",
            data=json.dumps(test_state),
            content_type="application/json",
        )
        assert response.status_code == 200

    def test_get_workspace_response_format(self, client):
        """GET /api/workspace returns valid JSON with required fields."""
        response = client.get("/api/workspace")
        assert response.status_code == 200
        assert response.content_type == "application/json"

        data = json.loads(response.data)
        assert isinstance(data, dict)
        assert "projects" in data
        assert "activeProjectPath" in data
        assert isinstance(data["projects"], list)
