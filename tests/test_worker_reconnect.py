"""Tests for worker reconnect callback functionality."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend.sdk_session import SessionManager


class TestWorkerReconnect:
    """Test auto-registration of callbacks when worker reconnects."""

    def test_on_session_reconnect_callback_is_called(self):
        """Verify on_session_reconnect is invoked for each active session."""
        with patch('backend.sdk_session.WorkerClient') as MockWorkerClient:
            mock_client = MagicMock()
            MockWorkerClient.return_value = mock_client

            # Create session manager
            manager = SessionManager()

            # Register a reconnect callback
            mock_callback = MagicMock()
            manager.on_session_reconnect = mock_callback

            # Simulate worker sending session status with 2 active sessions
            sessions = [
                {"session_id": "sess-1", "query_active": True},
                {"session_id": "sess-2", "query_active": True},
                {"session_id": "sess-3", "query_active": False},
            ]

            manager._handle_session_status(sessions)

            # Verify callback was called for each active session
            assert mock_callback.call_count == 2
            mock_callback.assert_any_call("sess-1")
            mock_callback.assert_any_call("sess-2")

    def test_on_session_reconnect_handles_exceptions(self):
        """Verify exceptions in reconnect callback don't crash the handler."""
        with patch('backend.sdk_session.WorkerClient') as MockWorkerClient:
            mock_client = MagicMock()
            MockWorkerClient.return_value = mock_client

            # Create session manager
            manager = SessionManager()

            # Register a callback that raises an exception
            def bad_callback(session_id):
                raise ValueError("Test error")

            manager.on_session_reconnect = bad_callback

            # Should not raise even though callback fails
            sessions = [{"session_id": "sess-1", "query_active": True}]
            manager._handle_session_status(sessions)

            # Active sessions should still be updated
            assert "sess-1" in manager._active_sessions

    def test_on_session_reconnect_not_called_if_none(self):
        """Verify no error when on_session_reconnect is None."""
        with patch('backend.sdk_session.WorkerClient') as MockWorkerClient:
            mock_client = MagicMock()
            MockWorkerClient.return_value = mock_client

            # Create session manager (on_session_reconnect starts as None)
            manager = SessionManager()

            # Should not raise when callback is None
            sessions = [{"session_id": "sess-1", "query_active": True}]
            manager._handle_session_status(sessions)

            # Active sessions should still be updated
            assert "sess-1" in manager._active_sessions
