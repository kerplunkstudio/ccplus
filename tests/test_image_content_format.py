"""Tests for image content format in SDK worker."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import base64
import tempfile
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.database import store_image
import backend.config as config


@pytest.fixture(autouse=True)
def use_test_db():
    """Use a temporary database for testing."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        temp_db = f.name

    original_db = config.DATABASE_PATH
    config.DATABASE_PATH = temp_db

    yield

    config.DATABASE_PATH = original_db
    Path(temp_db).unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_query_content_format_with_images():
    """Test that query content with images is a list of content blocks, not an async generator."""
    from backend.sdk_worker import SDKWorker

    # Create test image data (1x1 red pixel PNG)
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )

    # Store test image
    store_image(
        image_id="test-img-1",
        filename="test.png",
        mime_type="image/png",
        size=len(test_image_data),
        data=test_image_data,
        session_id="test-session",
    )

    worker = SDKWorker()

    # Mock the persistent session
    mock_client = AsyncMock()
    mock_client.query = AsyncMock()
    mock_client._query = MagicMock()

    # Mock receive_messages to return empty iterator (we just want to check query() was called correctly)
    async def empty_iterator():
        if False:
            yield

    mock_client._query.receive_messages.return_value = empty_iterator()

    mock_ps = MagicMock()
    mock_ps.client = mock_client
    mock_ps.query_active = False
    mock_ps.cancel_requested = False
    mock_ps.sdk_session_id = "sdk-session-123"

    # Mock get_or_create_client to return our mock session
    async def mock_get_or_create_client(session_id, workspace, model):
        return mock_ps

    worker.get_or_create_client = mock_get_or_create_client

    # Call stream_query with images
    try:
        await worker.stream_query(
            session_id="test-session",
            prompt="Describe this image",
            workspace="/tmp",
            model="sonnet",
            image_ids=["test-img-1"]
        )
    except StopAsyncIteration:
        pass  # Expected when iterator is exhausted

    # Verify query was called
    assert mock_client.query.called

    # Get the actual call arguments
    call_args = mock_client.query.call_args
    query_content_generator = call_args[0][0]  # First positional argument

    # Verify query_content is an async generator
    assert hasattr(query_content_generator, '__aiter__'), "Expected async iterable"

    # Consume the generator to get the actual message
    messages = []
    async for msg in query_content_generator:
        messages.append(msg)

    # Should yield exactly one message in streaming protocol format
    assert len(messages) == 1, f"Expected 1 message, got {len(messages)}"

    protocol_msg = messages[0]
    assert protocol_msg["type"] == "user"
    assert "message" in protocol_msg

    user_message = protocol_msg["message"]
    assert user_message["role"] == "user"
    assert "content" in user_message

    content_blocks = user_message["content"]
    assert isinstance(content_blocks, list)
    assert len(content_blocks) == 2, f"Expected 2 content blocks, got {len(content_blocks)}"

    # First block should be image
    image_block = content_blocks[0]
    assert image_block["type"] == "image"
    assert "source" in image_block
    assert image_block["source"]["type"] == "base64"
    assert image_block["source"]["media_type"] == "image/png"
    assert "data" in image_block["source"]

    # Second block should be text
    text_block = content_blocks[1]
    assert text_block["type"] == "text"
    assert text_block["text"] == "Describe this image"


@pytest.mark.asyncio
async def test_query_content_format_text_only():
    """Test that query content without images remains a simple string."""
    from backend.sdk_worker import SDKWorker

    worker = SDKWorker()

    # Mock the persistent session
    mock_client = AsyncMock()
    mock_client.query = AsyncMock()
    mock_client._query = MagicMock()

    # Mock receive_messages to return empty iterator
    async def empty_iterator():
        if False:
            yield

    mock_client._query.receive_messages.return_value = empty_iterator()

    mock_ps = MagicMock()
    mock_ps.client = mock_client
    mock_ps.query_active = False
    mock_ps.cancel_requested = False
    mock_ps.sdk_session_id = "sdk-session-123"

    # Mock get_or_create_client to return our mock session
    async def mock_get_or_create_client(session_id, workspace, model):
        return mock_ps

    worker.get_or_create_client = mock_get_or_create_client

    # Call stream_query without images
    try:
        await worker.stream_query(
            session_id="test-session",
            prompt="Hello, Claude!",
            workspace="/tmp",
            model="sonnet",
            image_ids=None
        )
    except StopAsyncIteration:
        pass  # Expected when iterator is exhausted

    # Verify query was called
    assert mock_client.query.called

    # Get the actual call arguments
    call_args = mock_client.query.call_args
    query_content = call_args[0][0]  # First positional argument

    # Verify query_content is a string (not a list, not an async generator)
    assert isinstance(query_content, str), f"Expected str, got {type(query_content)}"
    assert query_content == "Hello, Claude!"


@pytest.mark.asyncio
async def test_query_content_format_with_multiple_images():
    """Test that query content with multiple images includes all image blocks."""
    from backend.sdk_worker import SDKWorker

    # Create test image data
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )

    # Store multiple test images
    store_image("img-1", "test1.png", "image/png", len(test_image_data), test_image_data, "test-session")
    store_image("img-2", "test2.png", "image/png", len(test_image_data), test_image_data, "test-session")

    worker = SDKWorker()

    # Mock the persistent session
    mock_client = AsyncMock()
    mock_client.query = AsyncMock()
    mock_client._query = MagicMock()

    async def empty_iterator():
        if False:
            yield

    mock_client._query.receive_messages.return_value = empty_iterator()

    mock_ps = MagicMock()
    mock_ps.client = mock_client
    mock_ps.query_active = False
    mock_ps.cancel_requested = False
    mock_ps.sdk_session_id = "sdk-session-123"

    # Mock get_or_create_client to return our mock session
    async def mock_get_or_create_client(session_id, workspace, model):
        return mock_ps

    worker.get_or_create_client = mock_get_or_create_client

    # Call stream_query with multiple images
    try:
        await worker.stream_query(
            session_id="test-session",
            prompt="Compare these images",
            workspace="/tmp",
            model="sonnet",
            image_ids=["img-1", "img-2"]
        )
    except StopAsyncIteration:
        pass

    # Verify query was called
    assert mock_client.query.called

    # Get the actual call arguments
    call_args = mock_client.query.call_args
    query_content_generator = call_args[0][0]

    # Consume the generator to get the actual message
    messages = []
    async for msg in query_content_generator:
        messages.append(msg)

    assert len(messages) == 1
    protocol_msg = messages[0]
    assert protocol_msg["type"] == "user"

    content_blocks = protocol_msg["message"]["content"]
    assert isinstance(content_blocks, list)
    assert len(content_blocks) == 3, f"Expected 3 content blocks (2 images + 1 text), got {len(content_blocks)}"

    # Verify first two blocks are images
    assert content_blocks[0]["type"] == "image"
    assert content_blocks[1]["type"] == "image"

    # Verify last block is text
    assert content_blocks[2]["type"] == "text"
    assert content_blocks[2]["text"] == "Compare these images"
