"""
Test workspace state persistence functionality.

Tests the backend workspace state storage and API endpoints that enable
cross-client synchronization between web UI and desktop app.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend import database


class TestWorkspaceStatePersistence:
    """Test workspace state storage and retrieval."""

    def test_get_workspace_state_no_data(self):
        """get_workspace_state returns None when no state exists."""
        result = database.get_workspace_state("nonexistent_user")
        assert result is None

    def test_save_and_get_workspace_state(self):
        """save_workspace_state persists state and get_workspace_state retrieves it."""
        user_id = "test_user_1"
        test_state = {
            "projects": [
                {
                    "path": "/Users/test/project1",
                    "name": "Project 1",
                    "tabs": [
                        {
                            "sessionId": "session_123",
                            "label": "Main Session",
                            "isStreaming": False,
                            "hasRunningAgent": False,
                            "createdAt": 1234567890,
                        }
                    ],
                    "activeTabId": "session_123",
                }
            ],
            "activeProjectPath": "/Users/test/project1",
        }

        database.save_workspace_state(user_id, test_state)
        retrieved = database.get_workspace_state(user_id)

        assert retrieved is not None
        assert retrieved == test_state
        assert len(retrieved["projects"]) == 1
        assert retrieved["projects"][0]["path"] == "/Users/test/project1"
        assert len(retrieved["projects"][0]["tabs"]) == 1

    def test_save_workspace_state_upsert(self):
        """save_workspace_state updates existing state on conflict."""
        user_id = "test_user_2"

        # Initial save
        initial_state = {
            "projects": [{"path": "/project1", "name": "P1", "tabs": [], "activeTabId": None}],
            "activeProjectPath": "/project1",
        }
        database.save_workspace_state(user_id, initial_state)

        # Update with new state
        updated_state = {
            "projects": [
                {"path": "/project1", "name": "P1", "tabs": [], "activeTabId": None},
                {"path": "/project2", "name": "P2", "tabs": [], "activeTabId": None},
            ],
            "activeProjectPath": "/project2",
        }
        database.save_workspace_state(user_id, updated_state)

        # Verify only latest state persists
        retrieved = database.get_workspace_state(user_id)
        assert retrieved == updated_state
        assert len(retrieved["projects"]) == 2

    def test_workspace_state_with_multiple_tabs(self):
        """Workspace state correctly persists multiple tabs."""
        user_id = "test_user_3"
        test_state = {
            "projects": [
                {
                    "path": "/test/multi",
                    "name": "Multi Tab",
                    "tabs": [
                        {
                            "sessionId": "session_1",
                            "label": "Tab 1",
                            "isStreaming": False,
                            "hasRunningAgent": False,
                            "createdAt": 1000,
                        },
                        {
                            "sessionId": "session_2",
                            "label": "Tab 2",
                            "isStreaming": False,
                            "hasRunningAgent": False,
                            "createdAt": 2000,
                        },
                        {
                            "sessionId": "session_3",
                            "label": "Tab 3",
                            "isStreaming": False,
                            "hasRunningAgent": False,
                            "createdAt": 3000,
                        },
                    ],
                    "activeTabId": "session_2",
                }
            ],
            "activeProjectPath": "/test/multi",
        }

        database.save_workspace_state(user_id, test_state)
        retrieved = database.get_workspace_state(user_id)

        assert len(retrieved["projects"][0]["tabs"]) == 3
        assert retrieved["projects"][0]["activeTabId"] == "session_2"

    def test_workspace_state_with_multiple_projects(self):
        """Workspace state correctly persists multiple projects."""
        user_id = "test_user_4"
        test_state = {
            "projects": [
                {
                    "path": "/project/a",
                    "name": "Project A",
                    "tabs": [{"sessionId": "s1", "label": "A1", "isStreaming": False, "hasRunningAgent": False, "createdAt": 1000}],
                    "activeTabId": "s1",
                },
                {
                    "path": "/project/b",
                    "name": "Project B",
                    "tabs": [{"sessionId": "s2", "label": "B1", "isStreaming": False, "hasRunningAgent": False, "createdAt": 2000}],
                    "activeTabId": "s2",
                },
                {
                    "path": "/project/c",
                    "name": "Project C",
                    "tabs": [{"sessionId": "s3", "label": "C1", "isStreaming": False, "hasRunningAgent": False, "createdAt": 3000}],
                    "activeTabId": "s3",
                },
            ],
            "activeProjectPath": "/project/b",
        }

        database.save_workspace_state(user_id, test_state)
        retrieved = database.get_workspace_state(user_id)

        assert len(retrieved["projects"]) == 3
        assert retrieved["activeProjectPath"] == "/project/b"

    def test_workspace_state_empty_projects(self):
        """Workspace state handles empty projects array."""
        user_id = "test_user_5"
        test_state = {"projects": [], "activeProjectPath": None}

        database.save_workspace_state(user_id, test_state)
        retrieved = database.get_workspace_state(user_id)

        assert retrieved["projects"] == []
        assert retrieved["activeProjectPath"] is None

    def test_workspace_state_invalid_json_recovery(self):
        """get_workspace_state returns None for corrupted JSON."""
        user_id = "test_user_corrupted"
        # Directly insert invalid JSON into database
        conn = database._get_connection()
        # Delete any existing data for this user first
        conn.execute("DELETE FROM workspace_state WHERE user_id = ?", (user_id,))
        conn.execute(
            "INSERT INTO workspace_state (user_id, state) VALUES (?, ?)",
            (user_id, "invalid{json"),
        )
        conn.commit()

        result = database.get_workspace_state(user_id)
        assert result is None

    def test_workspace_state_isolation(self):
        """Workspace state is isolated per user."""
        user1 = "user_alpha"
        user2 = "user_beta"

        state1 = {
            "projects": [{"path": "/alpha", "name": "Alpha", "tabs": [], "activeTabId": None}],
            "activeProjectPath": "/alpha",
        }
        state2 = {
            "projects": [{"path": "/beta", "name": "Beta", "tabs": [], "activeTabId": None}],
            "activeProjectPath": "/beta",
        }

        database.save_workspace_state(user1, state1)
        database.save_workspace_state(user2, state2)

        retrieved1 = database.get_workspace_state(user1)
        retrieved2 = database.get_workspace_state(user2)

        assert retrieved1["activeProjectPath"] == "/alpha"
        assert retrieved2["activeProjectPath"] == "/beta"
        assert retrieved1 != retrieved2

    def test_workspace_state_updated_at_timestamp(self):
        """Workspace state includes updated_at timestamp."""
        user_id = "test_user_timestamp"
        test_state = {"projects": [], "activeProjectPath": None}

        database.save_workspace_state(user_id, test_state)

        # Directly query database to check updated_at
        conn = database._get_connection()
        row = conn.execute(
            "SELECT updated_at FROM workspace_state WHERE user_id = ?", (user_id,)
        ).fetchone()

        assert row is not None
        assert row["updated_at"] is not None
        # Timestamp should be in format: YYYY-MM-DD HH:MM:SS
        assert len(row["updated_at"]) >= 19
