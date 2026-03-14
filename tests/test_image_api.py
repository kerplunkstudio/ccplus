"""Tests for image upload API endpoints."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import base64
import io
import tempfile
import pytest

from backend.server import app
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


@pytest.fixture
def client():
    """Create a test client."""
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


def test_upload_image_success(client):
    """Test successful image upload."""
    # Create a small test image (1x1 red pixel PNG)
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )

    data = {
        'file': (io.BytesIO(test_image_data), 'test.png', 'image/png'),
        'session_id': 'test-session',
    }

    response = client.post('/api/images/upload', data=data, content_type='multipart/form-data')
    assert response.status_code == 200

    json_data = response.get_json()
    assert 'id' in json_data
    assert json_data['filename'] == 'test.png'
    assert json_data['mime_type'] == 'image/png'
    assert json_data['url'].startswith('/api/images/')


def test_upload_image_no_file(client):
    """Test upload without file fails."""
    data = {'session_id': 'test-session'}
    response = client.post('/api/images/upload', data=data, content_type='multipart/form-data')
    assert response.status_code == 400
    assert b'No file provided' in response.data


def test_upload_image_no_session(client):
    """Test upload without session_id fails."""
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )

    data = {
        'file': (io.BytesIO(test_image_data), 'test.png', 'image/png'),
    }

    response = client.post('/api/images/upload', data=data, content_type='multipart/form-data')
    assert response.status_code == 400
    assert b'session_id required' in response.data


def test_upload_image_invalid_type(client):
    """Test upload of non-image file fails."""
    data = {
        'file': (io.BytesIO(b'not an image'), 'test.txt', 'text/plain'),
        'session_id': 'test-session',
    }

    response = client.post('/api/images/upload', data=data, content_type='multipart/form-data')
    assert response.status_code == 400
    assert b'Unsupported image type' in response.data


def test_upload_image_too_large(client):
    """Test upload of file exceeding size limit fails."""
    # Create a file larger than 10MB
    large_data = b'x' * (11 * 1024 * 1024)

    data = {
        'file': (io.BytesIO(large_data), 'large.png', 'image/png'),
        'session_id': 'test-session',
    }

    response = client.post('/api/images/upload', data=data, content_type='multipart/form-data')
    assert response.status_code == 400
    assert b'File too large' in response.data


def test_get_image_success(client):
    """Test retrieving an uploaded image."""
    # First upload an image
    test_image_data = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )

    upload_data = {
        'file': (io.BytesIO(test_image_data), 'test.png', 'image/png'),
        'session_id': 'test-session',
    }

    upload_response = client.post('/api/images/upload', data=upload_data, content_type='multipart/form-data')
    assert upload_response.status_code == 200
    image_id = upload_response.get_json()['id']

    # Now retrieve it
    get_response = client.get(f'/api/images/{image_id}')
    assert get_response.status_code == 200
    assert get_response.content_type == 'image/png'
    assert get_response.data == test_image_data


def test_get_image_not_found(client):
    """Test retrieving a non-existent image returns 404."""
    response = client.get('/api/images/nonexistent-id')
    assert response.status_code == 404
