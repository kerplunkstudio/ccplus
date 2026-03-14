"""
Tests for backend.account_limits module.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from backend.account_limits import (
    _parse_reset_time,
    clear_cache,
    fetch_account_limits,
)


class TestParseResetTime:
    """Test the reset time parsing function."""

    def test_parse_iso_timestamp(self):
        """Test parsing ISO 8601 timestamp."""
        result = _parse_reset_time("2025-03-14T10:30:00Z")
        assert result is not None
        assert "2025-03-14" in result
        assert "10:30:00" in result

    def test_parse_unix_timestamp(self):
        """Test parsing Unix timestamp."""
        result = _parse_reset_time("1710412200")
        assert result is not None
        # Should return an ISO timestamp
        assert "T" in result

    def test_parse_none(self):
        """Test parsing None returns None."""
        result = _parse_reset_time(None)
        assert result is None

    def test_parse_invalid(self):
        """Test parsing invalid timestamp returns None."""
        result = _parse_reset_time("invalid")
        assert result is None


class TestFetchAccountLimits:
    """Test the account limits fetching function."""

    def setup_method(self):
        """Clear cache before each test."""
        clear_cache()

    def test_fetch_without_api_key(self):
        """Test fetching limits without API key configured."""
        with patch("backend.account_limits.ANTHROPIC_API_KEY", ""):
            result = fetch_account_limits()

        assert result["success"] is False
        assert "not configured" in result["error"]
        assert result["cached"] is False

    def test_fetch_with_api_error(self):
        """Test handling API errors."""
        with patch("backend.account_limits.ANTHROPIC_API_KEY", "test-key"):
            with patch("backend.account_limits.Anthropic") as mock_anthropic:
                mock_client = MagicMock()
                mock_anthropic.return_value = mock_client
                mock_client.messages.with_raw_response.create.side_effect = Exception("API Error")

                result = fetch_account_limits()

        assert result["success"] is False
        assert "API Error" in result["error"]
        assert result["cached"] is False

    def test_fetch_success(self):
        """Test successful limit fetching."""
        mock_headers = {
            "anthropic-ratelimit-requests-limit": "50",
            "anthropic-ratelimit-requests-remaining": "45",
            "anthropic-ratelimit-requests-reset": "2025-03-14T10:30:00Z",
            "anthropic-ratelimit-tokens-limit": "100000",
            "anthropic-ratelimit-tokens-remaining": "95000",
            "anthropic-ratelimit-tokens-reset": "2025-03-14T10:30:00Z",
        }

        with patch("backend.account_limits.ANTHROPIC_API_KEY", "test-key"):
            with patch("backend.account_limits.Anthropic") as mock_anthropic:
                mock_client = MagicMock()
                mock_anthropic.return_value = mock_client

                mock_response = MagicMock()
                mock_response.headers = mock_headers
                mock_client.messages.with_raw_response.create.return_value = mock_response

                result = fetch_account_limits()

        assert result["success"] is True
        assert result["cached"] is False
        assert "limits" in result
        assert result["limits"]["requests_limit"] == 50
        assert result["limits"]["requests_remaining"] == 45
        assert result["limits"]["tokens_limit"] == 100000
        assert result["limits"]["tokens_remaining"] == 95000

    def test_cache_behavior(self):
        """Test that results are cached."""
        mock_headers = {
            "anthropic-ratelimit-requests-limit": "50",
            "anthropic-ratelimit-requests-remaining": "45",
            "anthropic-ratelimit-requests-reset": "2025-03-14T10:30:00Z",
            "anthropic-ratelimit-tokens-limit": "100000",
            "anthropic-ratelimit-tokens-remaining": "95000",
            "anthropic-ratelimit-tokens-reset": "2025-03-14T10:30:00Z",
        }

        with patch("backend.account_limits.ANTHROPIC_API_KEY", "test-key"):
            with patch("backend.account_limits.Anthropic") as mock_anthropic:
                mock_client = MagicMock()
                mock_anthropic.return_value = mock_client

                mock_response = MagicMock()
                mock_response.headers = mock_headers
                mock_client.messages.with_raw_response.create.return_value = mock_response

                # First call - should hit API
                result1 = fetch_account_limits()
                assert result1["cached"] is False

                # Second call - should use cache
                result2 = fetch_account_limits()
                assert result2["cached"] is True

                # API should only be called once
                assert mock_client.messages.with_raw_response.create.call_count == 1

    def test_clear_cache(self):
        """Test cache clearing."""
        mock_headers = {
            "anthropic-ratelimit-requests-limit": "50",
            "anthropic-ratelimit-requests-remaining": "45",
            "anthropic-ratelimit-requests-reset": "2025-03-14T10:30:00Z",
            "anthropic-ratelimit-tokens-limit": "100000",
            "anthropic-ratelimit-tokens-remaining": "95000",
            "anthropic-ratelimit-tokens-reset": "2025-03-14T10:30:00Z",
        }

        with patch("backend.account_limits.ANTHROPIC_API_KEY", "test-key"):
            with patch("backend.account_limits.Anthropic") as mock_anthropic:
                mock_client = MagicMock()
                mock_anthropic.return_value = mock_client

                mock_response = MagicMock()
                mock_response.headers = mock_headers
                mock_client.messages.with_raw_response.create.return_value = mock_response

                # First call
                result1 = fetch_account_limits()
                assert result1["cached"] is False

                # Clear cache
                clear_cache()

                # Next call should hit API again
                result2 = fetch_account_limits()
                assert result2["cached"] is False

                # API should be called twice
                assert mock_client.messages.with_raw_response.create.call_count == 2
