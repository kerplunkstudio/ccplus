"""Tests for image upload functionality."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import base64
import tempfile
import pytest

from backend.database import (
    store_image,
    get_image,
    get_message_images,
    record_message,
    get_conversation_history,
    _get_connection,
)
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


def test_store_and_retrieve_image():
    """Test storing and retrieving an image."""
    # Create test image data (1x1 red pixel PNG)
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )

    # Store image
    image_meta = store_image(
        image_id="test-123",
        filename="test.png",
        mime_type="image/png",
        size=len(test_image_data),
        data=test_image_data,
        session_id="session-1",
    )

    assert image_meta["id"] == "test-123"
    assert image_meta["filename"] == "test.png"
    assert image_meta["mime_type"] == "image/png"
    assert image_meta["size"] == len(test_image_data)
    assert image_meta["url"] == "/api/images/test-123"

    # Retrieve image
    retrieved = get_image("test-123")
    assert retrieved is not None
    assert retrieved["id"] == "test-123"
    assert retrieved["filename"] == "test.png"
    assert retrieved["data"] == test_image_data


def test_get_nonexistent_image():
    """Test retrieving a non-existent image returns None."""
    result = get_image("nonexistent")
    assert result is None


def test_get_message_images():
    """Test retrieving multiple images by IDs."""
    # Create test image data
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )

    # Store multiple images
    store_image("img-1", "test1.png", "image/png", len(test_image_data), test_image_data, "session-1")
    store_image("img-2", "test2.png", "image/png", len(test_image_data), test_image_data, "session-1")
    store_image("img-3", "test3.png", "image/png", len(test_image_data), test_image_data, "session-1")

    # Retrieve subset
    images = get_message_images(["img-1", "img-3"])
    assert len(images) == 2
    assert images[0]["id"] == "img-1"
    assert images[0]["url"] == "/api/images/img-1"
    assert images[1]["id"] == "img-3"
    assert images[1]["url"] == "/api/images/img-3"

    # Empty list
    images = get_message_images([])
    assert len(images) == 0


def test_record_message_with_images():
    """Test recording a message with image attachments."""
    # Create test images
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )
    store_image("img-1", "test1.png", "image/png", len(test_image_data), test_image_data, "session-1")
    store_image("img-2", "test2.png", "image/png", len(test_image_data), test_image_data, "session-1")

    # Record message with images
    msg = record_message(
        session_id="session-1",
        user_id="user-1",
        role="user",
        content="Check this image",
        image_ids=["img-1", "img-2"],
    )

    assert msg["content"] == "Check this image"
    assert msg["images"] is not None

    # Verify conversation history includes images
    history = get_conversation_history("session-1")
    assert len(history) == 1
    assert history[0]["content"] == "Check this image"
    assert len(history[0]["images"]) == 2
    assert history[0]["images"][0]["id"] == "img-1"
    assert history[0]["images"][1]["id"] == "img-2"


def test_record_message_without_images():
    """Test recording a message without images still works."""
    msg = record_message(
        session_id="session-1",
        user_id="user-1",
        role="user",
        content="No images here",
    )

    assert msg["content"] == "No images here"

    # Verify conversation history
    history = get_conversation_history("session-1")
    assert len(history) == 1
    assert history[0]["content"] == "No images here"
    assert history[0]["images"] == []
