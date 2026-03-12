"""Test model parameter configuration."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import threading

from backend.sdk_session import SessionManager


class TestModelParameter:
    """Test that the model parameter is properly passed through the system."""

    @patch("backend.sdk_session.ClaudeSDKClient")
    @patch("backend.sdk_session.get_last_sdk_session_id")
    def test_model_parameter_passed_to_options(self, mock_get_last, mock_client_class):
        """Verify that the model parameter is passed to ClaudeCodeOptions."""
        mock_get_last.return_value = None

        # Mock the client instance
        mock_client = AsyncMock()
        mock_client.connect = AsyncMock()
        mock_client.query = AsyncMock()

        # Capture the options passed to ClaudeSDKClient
        captured_options = None
        def capture_client_init(options):
            nonlocal captured_options
            captured_options = options
            return mock_client

        mock_client_class.side_effect = capture_client_init

        mgr = SessionManager()
        try:
            completed = threading.Event()

            def on_complete(data):
                completed.set()

            # Submit query with custom model
            mgr.submit_query(
                session_id="test-session",
                prompt="Test prompt",
                workspace="/tmp",
                model="opus",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=on_complete,
                on_error=lambda e: None,
            )

            # Wait a bit for the client to be created
            completed.wait(timeout=2)

            # Verify the model was passed correctly
            assert captured_options is not None
            assert captured_options.model == "opus"
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.ClaudeSDKClient")
    @patch("backend.sdk_session.get_last_sdk_session_id")
    def test_model_defaults_to_sonnet(self, mock_get_last, mock_client_class):
        """Verify that model defaults to 'sonnet' when not provided."""
        mock_get_last.return_value = None

        # Mock the client instance
        mock_client = AsyncMock()
        mock_client.connect = AsyncMock()
        mock_client.query = AsyncMock()

        # Capture the options passed to ClaudeSDKClient
        captured_options = None
        def capture_client_init(options):
            nonlocal captured_options
            captured_options = options
            return mock_client

        mock_client_class.side_effect = capture_client_init

        mgr = SessionManager()
        try:
            completed = threading.Event()

            def on_complete(data):
                completed.set()

            # Submit query without model parameter
            mgr.submit_query(
                session_id="test-session-2",
                prompt="Test prompt",
                workspace="/tmp",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=on_complete,
                on_error=lambda e: None,
            )

            # Wait a bit for the client to be created
            completed.wait(timeout=2)

            # Verify the model defaults to sonnet
            assert captured_options is not None
            assert captured_options.model == "sonnet"
        finally:
            mgr.shutdown()

    @patch("backend.sdk_session.ClaudeSDKClient")
    @patch("backend.sdk_session.get_last_sdk_session_id")
    def test_model_change_recreates_client(self, mock_get_last, mock_client_class):
        """Verify that changing model recreates the client."""
        mock_get_last.return_value = None

        # Track how many times client is created
        create_count = 0

        # Mock the client instance
        def create_mock_client(options):
            nonlocal create_count
            create_count += 1
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.query = AsyncMock()
            mock_client.disconnect = AsyncMock()
            return mock_client

        mock_client_class.side_effect = create_mock_client

        mgr = SessionManager()
        try:
            # First query with haiku
            event1 = threading.Event()
            mgr.submit_query(
                session_id="test-session-3",
                prompt="First query",
                workspace="/tmp",
                model="haiku",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=lambda d: event1.set(),
                on_error=lambda e: event1.set(),
            )
            event1.wait(timeout=2)

            # Second query with opus (should recreate client)
            event2 = threading.Event()
            mgr.submit_query(
                session_id="test-session-3",
                prompt="Second query",
                workspace="/tmp",
                model="opus",
                on_text=lambda t: None,
                on_tool_event=lambda e: None,
                on_complete=lambda d: event2.set(),
                on_error=lambda e: event2.set(),
            )
            event2.wait(timeout=2)

            # Should have created client twice (once for haiku, once for opus)
            assert create_count == 2
        finally:
            mgr.shutdown()
