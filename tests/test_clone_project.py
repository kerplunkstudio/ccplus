"""Tests for GitHub repository cloning functionality."""

import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

# Patch sdk_session before importing server
with patch("backend.sdk_session.SessionManager") as _MockSM:
    mock_instance = MagicMock()
    mock_instance.get_active_sessions.return_value = []
    mock_instance.is_active.return_value = False
    mock_instance.get_pending_question.return_value = None
    _MockSM.return_value = mock_instance
    from backend.server import app


@pytest.fixture()
def client():
    """Flask test client."""
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


class TestCloneProject:
    """Test suite for /api/projects/clone endpoint."""

    def test_clone_missing_url(self, client):
        """Should return 400 when 'url' is missing from request body."""
        response = client.post('/api/projects/clone', json={})
        assert response.status_code == 400
        data = response.get_json()
        assert "Missing 'url'" in data["error"]

    def test_clone_empty_url(self, client):
        """Should return 400 when 'url' is empty."""
        response = client.post('/api/projects/clone', json={"url": ""})
        assert response.status_code == 400
        data = response.get_json()
        assert "Empty repository URL" in data["error"]

    def test_clone_invalid_url_format(self, client):
        """Should return 400 for invalid GitHub URL formats."""
        invalid_urls = [
            "not-a-url",
            "https://gitlab.com/user/repo",
            "https://github.com/user",
            "git@bitbucket.org:user/repo.git",
            "ftp://github.com/user/repo",
        ]
        for url in invalid_urls:
            response = client.post('/api/projects/clone', json={"url": url})
            assert response.status_code == 400
            data = response.get_json()
            assert "Invalid GitHub URL format" in data["error"]

    def test_clone_valid_https_url_format(self, client):
        """Should accept valid HTTPS GitHub URLs."""
        valid_urls = [
            "https://github.com/user/repo",
            "https://github.com/user/repo.git",
            "http://github.com/user-name/repo-name",
            "http://github.com/user_name/repo_name.git",
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                for url in valid_urls:
                    # Mock subprocess to avoid actual cloning
                    with patch("backend.server.subprocess.run") as mock_run:
                        mock_run.return_value.returncode = 0
                        mock_run.return_value.stderr = ""
                        mock_run.return_value.stdout = ""

                        response = client.post('/api/projects/clone', json={"url": url})

                        # Should not reject based on URL format
                        assert response.status_code in [200, 409, 500]  # Could fail for other reasons

    def test_clone_valid_ssh_url_format(self, client):
        """Should accept valid SSH GitHub URLs."""
        valid_urls = [
            "git@github.com:user/repo",
            "git@github.com:user/repo.git",
            "git@github.com:user-name/repo-name",
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                for url in valid_urls:
                    # Mock subprocess to avoid actual cloning
                    with patch("backend.server.subprocess.run") as mock_run:
                        mock_run.return_value.returncode = 0
                        mock_run.return_value.stderr = ""
                        mock_run.return_value.stdout = ""

                        response = client.post('/api/projects/clone', json={"url": url})

                        # Should not reject based on URL format
                        assert response.status_code in [200, 409, 500]

    def test_clone_directory_already_exists(self, client):
        """Should return 409 when target directory already exists."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            # Create a directory that will conflict
            existing_repo = temp_path / "test-repo"
            existing_repo.mkdir()

            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                response = client.post(
                    '/api/projects/clone',
                    json={"url": "https://github.com/user/test-repo.git"}
                )

                assert response.status_code == 409
                data = response.get_json()
                assert "already exists" in data["error"]

    def test_clone_subprocess_failure(self, client):
        """Should return 500 when git clone subprocess fails."""
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                with patch("backend.server.subprocess.run") as mock_run:
                    mock_run.return_value.returncode = 1
                    mock_run.return_value.stderr = "fatal: repository not found"
                    mock_run.return_value.stdout = ""

                    response = client.post(
                        '/api/projects/clone',
                        json={"url": "https://github.com/user/nonexistent-repo.git"}
                    )

                    assert response.status_code == 500
                    data = response.get_json()
                    assert "Failed to clone repository" in data["error"]
                    assert "repository not found" in data["error"]

    def test_clone_timeout(self, client):
        """Should return 504 when git clone times out."""
        import subprocess

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                with patch("backend.server.subprocess.run") as mock_run:
                    mock_run.side_effect = subprocess.TimeoutExpired(
                        cmd="git clone",
                        timeout=300
                    )

                    response = client.post(
                        '/api/projects/clone',
                        json={"url": "https://github.com/user/huge-repo.git"}
                    )

                    assert response.status_code == 504
                    data = response.get_json()
                    assert "timed out" in data["error"]

    def test_clone_success(self, client):
        """Should successfully clone and return project details."""
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                with patch("backend.server.subprocess.run") as mock_run:
                    mock_run.return_value.returncode = 0
                    mock_run.return_value.stderr = ""
                    mock_run.return_value.stdout = "Cloning into 'test-repo'..."

                    response = client.post(
                        '/api/projects/clone',
                        json={"url": "https://github.com/user/test-repo.git"}
                    )

                    assert response.status_code == 200
                    data = response.get_json()
                    assert data["name"] == "test-repo"
                    assert "test-repo" in data["path"]
                    # Verify the path is inside the temp workspace (resolve to handle /private prefix on macOS)
                    assert Path(data["path"]).resolve().parent == Path(temp_dir).resolve()

    def test_clone_extracts_correct_repo_name(self, client):
        """Should correctly extract repository name from various URL formats."""
        test_cases = [
            ("https://github.com/user/my-repo", "my-repo"),
            ("https://github.com/user/my-repo.git", "my-repo"),
            ("https://github.com/user/my-repo/", "my-repo"),
            ("git@github.com:user/my-repo", "my-repo"),
            ("git@github.com:user/my-repo.git", "my-repo"),
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                with patch("backend.server.subprocess.run") as mock_run:
                    mock_run.return_value.returncode = 0
                    mock_run.return_value.stderr = ""
                    mock_run.return_value.stdout = ""

                    for url, expected_name in test_cases:
                        response = client.post(
                            '/api/projects/clone',
                            json={"url": url}
                        )

                        if response.status_code == 200:
                            data = response.get_json()
                            assert data["name"] == expected_name

                        # Clean up for next iteration
                        created_dir = Path(temp_dir) / expected_name
                        if created_dir.exists():
                            created_dir.rmdir()

    def test_clone_calls_git_with_correct_args(self, client):
        """Should invoke git clone with correct arguments."""
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("backend.server.WORKSPACE_PATH", temp_dir):
                with patch("backend.server.subprocess.run") as mock_run:
                    mock_run.return_value.returncode = 0
                    mock_run.return_value.stderr = ""
                    mock_run.return_value.stdout = ""

                    url = "https://github.com/user/test-repo.git"
                    client.post('/api/projects/clone', json={"url": url})

                    # Verify subprocess was called with correct arguments
                    mock_run.assert_called_once()
                    call_args = mock_run.call_args[0][0]
                    assert call_args[0] == "git"
                    assert call_args[1] == "clone"
                    assert call_args[2] == url
                    assert "test-repo" in call_args[3]

                    # Verify timeout was set
                    assert mock_run.call_args[1]["timeout"] == 300
