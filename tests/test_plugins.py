"""
Tests for plugin management module.

Tests CLI command wrapping, plugin listing, installation,
and skill discovery.
"""

import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.plugins import PluginManager


class TestPluginManager:
    """Test plugin management functionality."""

    @pytest.fixture
    def manager(self):
        """Create a plugin manager instance."""
        return PluginManager()

    def test_find_claude_binary(self, manager):
        """Test finding Claude CLI binary."""
        assert manager.claude_bin is not None
        assert isinstance(manager.claude_bin, str)

    @patch("subprocess.run")
    def test_list_installed_success(self, mock_run, manager):
        """Test listing installed plugins successfully."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = '[{"id": "test@test", "version": "1.0.0"}]'
        mock_result.stderr = ""
        mock_run.return_value = mock_result

        # Mock enrichment to avoid filesystem access
        with patch.object(manager, "_enrich_plugin_data", return_value={"name": "test", "skills": []}):
            result = manager.list_installed()

        assert result["success"] is True
        assert isinstance(result["data"], list)

    @patch("subprocess.run")
    def test_list_installed_error(self, mock_run, manager):
        """Test handling errors when listing plugins."""
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Command failed"
        mock_run.return_value = mock_result

        result = manager.list_installed()

        assert result["success"] is False
        assert "error" in result

    @patch("subprocess.run")
    def test_list_marketplaces_success(self, mock_run, manager):
        """Test listing marketplaces successfully."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = '[{"name": "official", "repo": "anthropics/plugins"}]'
        mock_result.stderr = ""
        mock_run.return_value = mock_result

        result = manager.list_marketplaces()

        assert result["success"] is True
        assert isinstance(result["data"], list)

    @patch("subprocess.run")
    def test_install_plugin_success(self, mock_run, manager):
        """Test installing a plugin successfully."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""
        mock_run.return_value = mock_result

        result = manager.install_plugin("test-plugin")

        assert result["success"] is True
        assert result["plugin"] == "test-plugin"

    @patch("subprocess.run")
    def test_install_plugin_error(self, mock_run, manager):
        """Test handling errors when installing a plugin."""
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Installation failed"
        mock_run.return_value = mock_result

        result = manager.install_plugin("invalid-plugin")

        assert result["success"] is False
        assert "error" in result

    @patch("subprocess.run")
    def test_uninstall_plugin_success(self, mock_run, manager):
        """Test uninstalling a plugin successfully."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = ""
        mock_result.stderr = ""
        mock_run.return_value = mock_result

        result = manager.uninstall_plugin("test-plugin")

        assert result["success"] is True
        assert result["plugin"] == "test-plugin"

    @patch.object(PluginManager, "list_installed")
    def test_get_plugin_skills_found(self, mock_list, manager):
        """Test getting skills for an installed plugin."""
        mock_list.return_value = {
            "success": True,
            "data": [
                {"name": "test-plugin", "skills": ["skill1", "skill2"]},
            ],
        }

        result = manager.get_plugin_skills("test-plugin")

        assert result["success"] is True
        assert result["skills"] == ["skill1", "skill2"]

    @patch.object(PluginManager, "list_installed")
    def test_get_plugin_skills_not_found(self, mock_list, manager):
        """Test getting skills for a non-existent plugin."""
        mock_list.return_value = {
            "success": True,
            "data": [],
        }

        result = manager.get_plugin_skills("nonexistent")

        assert result["success"] is False
        assert "error" in result

    @patch.object(PluginManager, "list_installed")
    def test_get_all_skills(self, mock_list, manager):
        """Test getting all skills from all plugins."""
        mock_list.return_value = {
            "success": True,
            "data": [
                {"name": "plugin1", "version": "1.0", "skills": ["skill1", "skill2"]},
                {"name": "plugin2", "version": "2.0", "skills": ["skill3"]},
            ],
        }

        result = manager.get_all_skills()

        assert result["success"] is True
        assert len(result["skills"]) == 3
        assert all("name" in s and "plugin" in s for s in result["skills"])

    @patch("subprocess.run")
    def test_command_timeout(self, mock_run, manager):
        """Test handling command timeout."""
        from subprocess import TimeoutExpired

        mock_run.side_effect = TimeoutExpired(cmd=["claude"], timeout=30)

        result = manager._run_command(["plugin", "list"])

        assert result["success"] is False
        assert "timed out" in result["error"].lower()

    @patch("subprocess.run")
    def test_invalid_json_response(self, mock_run, manager):
        """Test handling invalid JSON in command output."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "not valid json"
        mock_result.stderr = ""
        mock_run.return_value = mock_result

        result = manager._run_command(["plugin", "list", "--json"])

        assert result["success"] is False
        assert "JSON" in result["error"]

    def test_enrich_plugin_data_nonexistent_path(self, manager):
        """Test enriching plugin data with nonexistent install path."""
        plugin_data = {
            "id": "test@test",
            "installPath": "/nonexistent/path",
        }

        result = manager._enrich_plugin_data(plugin_data)

        assert result["name"] == "test"
        assert result["skills"] == []
        assert result["agents"] == []
