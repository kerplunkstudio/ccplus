"""Tests for SDK worker event buffering."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import asyncio
import pytest
from unittest.mock import AsyncMock, Mock, patch
from backend.sdk_worker import SDKWorker, encode_message
import backend.config as config


class TestEventBuffering:
    """Test event buffering during Flask disconnects."""

    @pytest.fixture
    def worker(self):
        """Create a fresh SDKWorker instance."""
        return SDKWorker()

    @pytest.mark.asyncio
    async def test_events_buffered_when_disconnected(self, worker):
        """Events should be buffered when Flask is disconnected."""
        # Flask is not connected yet
        assert worker._flask_writer is None

        # Send event with session_id
        event = {
            "type": "text_delta",
            "session_id": "session_123",
            "text": "Hello",
        }
        await worker.send_event(event)

        # Event should be buffered
        assert "session_123" in worker._event_buffer
        assert len(worker._event_buffer["session_123"]) == 1
        assert worker._event_buffer["session_123"][0] == event

    @pytest.mark.asyncio
    async def test_events_without_session_id_dropped(self, worker):
        """Events without session_id should be dropped, not buffered."""
        # Send event without session_id (like pong)
        event = {"type": "pong"}
        await worker.send_event(event)

        # No buffer should be created
        assert len(worker._event_buffer) == 0

    @pytest.mark.asyncio
    async def test_buffer_overflow_drops_oldest(self, worker):
        """Buffer should drop oldest events when full."""
        # Fill buffer to capacity
        for i in range(config.WORKER_EVENT_BUFFER_SIZE):
            event = {
                "type": "text_delta",
                "session_id": "session_123",
                "text": f"Message {i}",
            }
            await worker.send_event(event)

        # Buffer should be at capacity
        assert len(worker._event_buffer["session_123"]) == config.WORKER_EVENT_BUFFER_SIZE
        assert worker._event_buffer["session_123"][0]["text"] == "Message 0"

        # Add one more event
        overflow_event = {
            "type": "text_delta",
            "session_id": "session_123",
            "text": "Overflow message",
        }
        await worker.send_event(overflow_event)

        # Buffer should still be at capacity, oldest dropped
        assert len(worker._event_buffer["session_123"]) == config.WORKER_EVENT_BUFFER_SIZE
        assert worker._event_buffer["session_123"][0]["text"] == "Message 1"  # Oldest dropped
        assert worker._event_buffer["session_123"][-1]["text"] == "Overflow message"

    @pytest.mark.asyncio
    async def test_events_sent_when_connected(self, worker):
        """Events should be sent directly when Flask is connected."""
        # Create mock writer
        mock_writer = AsyncMock()
        mock_writer.write = Mock()
        mock_writer.drain = AsyncMock()
        worker._flask_writer = mock_writer

        # Send event
        event = {
            "type": "text_delta",
            "session_id": "session_123",
            "text": "Hello",
        }
        await worker.send_event(event)

        # Event should be sent, not buffered
        mock_writer.write.assert_called_once()
        mock_writer.drain.assert_called_once()
        assert len(worker._event_buffer) == 0

    @pytest.mark.asyncio
    async def test_send_failure_buffers_event(self, worker):
        """If send fails, event should be buffered and writer cleared."""
        # Create mock writer that fails
        mock_writer = AsyncMock()
        mock_writer.write = Mock(side_effect=Exception("Write failed"))
        worker._flask_writer = mock_writer

        # Send event
        event = {
            "type": "text_delta",
            "session_id": "session_123",
            "text": "Hello",
        }
        await worker.send_event(event)

        # Writer should be cleared
        assert worker._flask_writer is None

        # Event should be buffered
        assert "session_123" in worker._event_buffer
        assert len(worker._event_buffer["session_123"]) == 1
        assert worker._event_buffer["session_123"][0] == event

    @pytest.mark.asyncio
    async def test_buffer_replay_on_reconnect(self, worker):
        """Buffered events should replay when Flask reconnects."""
        # Buffer some events while disconnected
        events = [
            {"type": "text_delta", "session_id": "session_123", "text": "Hello"},
            {"type": "tool_event", "session_id": "session_123", "event": {"tool": "Bash"}},
            {"type": "response_complete", "session_id": "session_123", "cost": 0.01},
        ]
        for event in events:
            await worker.send_event(event)

        assert len(worker._event_buffer["session_123"]) == 3

        # Create mock reader/writer for reconnection
        mock_reader = AsyncMock()
        mock_reader.readline = AsyncMock(return_value=b"")  # EOF after status
        mock_writer = AsyncMock()
        mock_writer.write = Mock()
        mock_writer.drain = AsyncMock()

        # Simulate reconnection by calling handle_client
        # We need to stop it quickly after replay, so make readline return EOF
        task = asyncio.create_task(worker.handle_client(mock_reader, mock_writer))
        await asyncio.sleep(0.1)  # Give time for replay

        # Check that all events were written
        # First call is session_status, then the 3 buffered events
        assert mock_writer.write.call_count >= 3

        # Buffer should be cleared
        assert "session_123" not in worker._event_buffer or len(worker._event_buffer["session_123"]) == 0

        # Clean up
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_buffer_multiple_sessions(self, worker):
        """Buffer should handle events from multiple sessions."""
        # Send events from different sessions
        await worker.send_event({"type": "text_delta", "session_id": "session_1", "text": "A"})
        await worker.send_event({"type": "text_delta", "session_id": "session_2", "text": "B"})
        await worker.send_event({"type": "text_delta", "session_id": "session_1", "text": "C"})

        # Both sessions should have buffers
        assert len(worker._event_buffer["session_1"]) == 2
        assert len(worker._event_buffer["session_2"]) == 1
        assert worker._event_buffer["session_1"][0]["text"] == "A"
        assert worker._event_buffer["session_1"][1]["text"] == "C"
        assert worker._event_buffer["session_2"][0]["text"] == "B"

    @pytest.mark.asyncio
    async def test_replay_failure_preserves_buffer(self, worker):
        """If replay fails, buffer should be preserved."""
        # Buffer an event
        event = {"type": "text_delta", "session_id": "session_123", "text": "Hello"}
        await worker.send_event(event)

        # Create mock writer that fails on write
        mock_reader = AsyncMock()
        mock_reader.readline = AsyncMock(return_value=b"")
        mock_writer = AsyncMock()
        mock_writer.write = Mock(side_effect=Exception("Write failed"))
        mock_writer.drain = AsyncMock()

        # Attempt reconnection (should fail during replay)
        task = asyncio.create_task(worker.handle_client(mock_reader, mock_writer))
        await asyncio.sleep(0.1)

        # Buffer should still contain the event
        assert "session_123" in worker._event_buffer
        assert len(worker._event_buffer["session_123"]) == 1

        # Clean up
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_encode_message(self):
        """Test message encoding produces valid JSON."""
        msg = {"type": "text_delta", "session_id": "test", "text": "Hello"}
        encoded = encode_message(msg)

        # Should be bytes ending with newline
        assert isinstance(encoded, bytes)
        assert encoded.endswith(b"\n")

        # Should be valid JSON
        import json
        decoded = json.loads(encoded.decode("utf-8"))
        assert decoded == msg


class TestBufferLogging:
    """Test logging behavior for buffer events."""

    @pytest.fixture
    def worker(self):
        """Create a fresh SDKWorker instance."""
        return SDKWorker()

    @pytest.mark.asyncio
    async def test_buffer_overflow_logs_warning_once(self, worker):
        """Buffer overflow should log warning only on first overflow."""
        with patch('backend.sdk_worker.logger') as mock_logger:
            # Fill buffer to capacity + 2
            for i in range(config.WORKER_EVENT_BUFFER_SIZE + 2):
                event = {
                    "type": "text_delta",
                    "session_id": "session_123",
                    "text": f"Message {i}",
                }
                await worker.send_event(event)

            # Should log warning only once (when buffer first hits limit)
            warning_calls = [call for call in mock_logger.warning.call_args_list
                           if "Event buffer full" in str(call)]
            assert len(warning_calls) == 1

    @pytest.mark.asyncio
    async def test_replay_logs_info(self, worker):
        """Buffer replay should log info messages."""
        # Buffer some events
        for i in range(3):
            await worker.send_event({
                "type": "text_delta",
                "session_id": "session_123",
                "text": f"Message {i}",
            })

        with patch('backend.sdk_worker.logger') as mock_logger:
            # Simulate reconnection
            mock_reader = AsyncMock()
            mock_reader.readline = AsyncMock(return_value=b"")
            mock_writer = AsyncMock()
            mock_writer.write = Mock()
            mock_writer.drain = AsyncMock()

            task = asyncio.create_task(worker.handle_client(mock_reader, mock_writer))
            await asyncio.sleep(0.1)

            # Should log replay start and completion
            info_calls = [str(call) for call in mock_logger.info.call_args_list]
            assert any("Replaying 3 buffered events" in call for call in info_calls)
            assert any("Buffer replay complete" in call for call in info_calls)

            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
