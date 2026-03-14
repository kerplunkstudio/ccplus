"""Tests for user stats persistence."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from backend.database import get_user_stats, increment_user_stats, _get_connection


@pytest.fixture
def clean_stats():
    """Clear user_stats table before each test."""
    conn = _get_connection()
    conn.execute("DELETE FROM user_stats")
    conn.commit()
    yield
    conn.execute("DELETE FROM user_stats")
    conn.commit()


class TestUserStats:
    def test_get_user_stats_creates_row_if_missing(self, clean_stats):
        """Test that get_user_stats creates a row if it doesn't exist."""
        stats = get_user_stats("test_user")
        assert stats["user_id"] == "test_user"
        assert stats["total_sessions"] == 0
        assert stats["total_queries"] == 0
        assert stats["total_duration_ms"] == 0.0
        assert stats["total_cost"] == 0.0
        assert stats["total_input_tokens"] == 0
        assert stats["total_output_tokens"] == 0
        assert stats["total_lines_of_code"] == 0
        assert "updated_at" in stats

    def test_get_user_stats_returns_existing_row(self, clean_stats):
        """Test that get_user_stats returns existing data."""
        # Create a row
        increment_user_stats(user_id="test_user", sessions=5, queries=10)

        # Fetch it
        stats = get_user_stats("test_user")
        assert stats["total_sessions"] == 5
        assert stats["total_queries"] == 10

    def test_increment_user_stats_creates_row(self, clean_stats):
        """Test that increment_user_stats creates a row if missing."""
        increment_user_stats(
            user_id="new_user",
            sessions=1,
            queries=2,
            duration_ms=1000.5,
            cost=0.01,
            input_tokens=500,
            output_tokens=200,
            lines_of_code=25
        )

        stats = get_user_stats("new_user")
        assert stats["total_sessions"] == 1
        assert stats["total_queries"] == 2
        assert stats["total_duration_ms"] == 1000.5
        assert stats["total_cost"] == 0.01
        assert stats["total_input_tokens"] == 500
        assert stats["total_output_tokens"] == 200
        assert stats["total_lines_of_code"] == 25

    def test_increment_user_stats_increments_existing(self, clean_stats):
        """Test that increment_user_stats adds to existing values."""
        # First increment
        increment_user_stats(user_id="test_user", sessions=1, queries=2, cost=0.01)

        # Second increment
        increment_user_stats(user_id="test_user", queries=3, cost=0.02, lines_of_code=50)

        stats = get_user_stats("test_user")
        assert stats["total_sessions"] == 1  # Only incremented once
        assert stats["total_queries"] == 5  # 2 + 3
        assert stats["total_cost"] == 0.03  # 0.01 + 0.02
        assert stats["total_lines_of_code"] == 50  # Only set once

    def test_increment_user_stats_partial_fields(self, clean_stats):
        """Test that increment_user_stats only updates specified fields."""
        increment_user_stats(user_id="test_user", sessions=1, cost=0.01)

        stats = get_user_stats("test_user")
        assert stats["total_sessions"] == 1
        assert stats["total_cost"] == 0.01
        assert stats["total_queries"] == 0  # Not updated
        assert stats["total_input_tokens"] == 0  # Not updated

    def test_increment_user_stats_multiple_users(self, clean_stats):
        """Test that stats are isolated per user."""
        increment_user_stats(user_id="user1", sessions=1, queries=5)
        increment_user_stats(user_id="user2", sessions=2, queries=10)

        stats1 = get_user_stats("user1")
        stats2 = get_user_stats("user2")

        assert stats1["total_sessions"] == 1
        assert stats1["total_queries"] == 5
        assert stats2["total_sessions"] == 2
        assert stats2["total_queries"] == 10

    def test_increment_user_stats_float_duration(self, clean_stats):
        """Test that duration_ms accepts float values."""
        increment_user_stats(user_id="test_user", duration_ms=1234.567)

        stats = get_user_stats("test_user")
        assert stats["total_duration_ms"] == 1234.567

    def test_increment_user_stats_large_numbers(self, clean_stats):
        """Test that stats handle large numbers correctly."""
        increment_user_stats(
            user_id="test_user",
            input_tokens=1000000,
            output_tokens=500000,
            lines_of_code=100000
        )

        stats = get_user_stats("test_user")
        assert stats["total_input_tokens"] == 1000000
        assert stats["total_output_tokens"] == 500000
        assert stats["total_lines_of_code"] == 100000

    def test_increment_user_stats_zero_values(self, clean_stats):
        """Test that zero values are handled correctly."""
        increment_user_stats(user_id="test_user", sessions=0, queries=0, cost=0.0)

        stats = get_user_stats("test_user")
        assert stats["total_sessions"] == 0
        assert stats["total_queries"] == 0
        assert stats["total_cost"] == 0.0

    def test_get_user_stats_idempotent(self, clean_stats):
        """Test that calling get_user_stats multiple times doesn't change values."""
        stats1 = get_user_stats("test_user")
        stats2 = get_user_stats("test_user")
        stats3 = get_user_stats("test_user")

        assert stats1["total_sessions"] == stats2["total_sessions"] == stats3["total_sessions"] == 0
        assert stats1["user_id"] == stats2["user_id"] == stats3["user_id"] == "test_user"
