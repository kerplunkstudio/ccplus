import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import json
import pytest
import tempfile
import shutil
from unittest.mock import MagicMock, patch

from backend.plugins import PluginManager, Plugin, CLAUDE_DIR


@pytest.fixture
def temp_claude_dir(tmp_path, monkeypatch):
    """Create a temporary Claude directory for testing."""
    temp_dir = tmp_path / ".claude"
    temp_dir.mkdir()

    plugins_dir = temp_dir / "plugins"
    plugins_dir.mkdir()

    # Patch the module-level constants
    monkeypatch.setattr("backend.plugins.CLAUDE_DIR", temp_dir)
    monkeypatch.setattr("backend.plugins.PLUGINS_DIR", plugins_dir)
    monkeypatch.setattr("backend.plugins.MARKETPLACES_DIR", plugins_dir / "marketplaces")
    monkeypatch.setattr("backend.plugins.CACHE_DIR", plugins_dir / "cache")
    monkeypatch.setattr(
        "backend.plugins.INSTALLED_PLUGINS_FILE", plugins_dir / "installed_plugins.json"
    )
    monkeypatch.setattr(
        "backend.plugins.KNOWN_MARKETPLACES_FILE", plugins_dir / "known_marketplaces.json"
    )

    yield temp_dir


@pytest.fixture
def plugin_manager(temp_claude_dir):
    """Create a plugin manager with temporary directories."""
    return PluginManager()


class TestPluginManager:
    def test_init_creates_directories(self, temp_claude_dir):
        """Test that PluginManager creates required directories."""
        manager = PluginManager()

        plugins_dir = temp_claude_dir / "plugins"
        assert plugins_dir.exists()
        assert (plugins_dir / "marketplaces").exists()
        assert (plugins_dir / "cache").exists()
        assert (plugins_dir / "installed_plugins.json").exists()
        assert (plugins_dir / "known_marketplaces.json").exists()

    def test_list_installed_empty(self, plugin_manager):
        """Test listing installed plugins when none are installed."""
        plugins = plugin_manager.list_installed()
        assert plugins == []

    def test_list_installed_with_plugins(self, plugin_manager, temp_claude_dir):
        """Test listing installed plugins."""
        # Create a fake installed plugin
        cache_dir = temp_claude_dir / "plugins" / "cache"
        plugin_dir = cache_dir / "test-owner" / "test-plugin" / "1.0.0"
        plugin_dir.mkdir(parents=True)

        # Create plugin.json
        plugin_json_dir = plugin_dir / ".claude-plugin"
        plugin_json_dir.mkdir()
        plugin_json = plugin_json_dir / "plugin.json"
        plugin_json.write_text(
            json.dumps(
                {
                    "name": "test-plugin",
                    "version": "1.0.0",
                    "description": "Test plugin",
                    "author": {"name": "Test Author"},
                    "repository": "https://github.com/test-owner/test-plugin",
                }
            )
        )

        # Add to installed_plugins.json
        installed_file = temp_claude_dir / "plugins" / "installed_plugins.json"
        installed_file.write_text(
            json.dumps(
                {
                    "version": 2,
                    "plugins": {
                        "test-owner@test-plugin": [
                            {
                                "scope": "user",
                                "installPath": str(plugin_dir),
                                "version": "1.0.0",
                                "installedAt": "2026-01-01T00:00:00Z",
                            }
                        ]
                    },
                }
            )
        )

        plugins = plugin_manager.list_installed()
        assert len(plugins) == 1
        assert plugins[0].name == "test-plugin"
        assert plugins[0].version == "1.0.0"
        assert plugins[0].installed is True

    def test_list_marketplace_empty(self, plugin_manager):
        """Test listing marketplace plugins when marketplace is empty."""
        plugins = plugin_manager.list_marketplace()
        assert isinstance(plugins, list)

    @patch("backend.plugins.PluginManager._fetch_github_repo")
    def test_install_from_github(self, mock_fetch, plugin_manager, temp_claude_dir):
        """Test installing a plugin from GitHub."""
        # Mock git clone
        mock_fetch.return_value = True

        # Create fake plugin metadata
        def create_fake_plugin(repo, target_dir):
            target_dir.mkdir(parents=True, exist_ok=True)
            plugin_json_dir = target_dir / ".claude-plugin"
            plugin_json_dir.mkdir()
            plugin_json = plugin_json_dir / "plugin.json"
            plugin_json.write_text(
                json.dumps(
                    {
                        "name": "test-plugin",
                        "version": "1.0.0",
                        "description": "Test plugin",
                        "author": {"name": "Test Author"},
                        "repository": "https://github.com/test-owner/test-plugin",
                        "agents": [],
                        "skills": [],
                        "commands": [],
                    }
                )
            )
            return True

        mock_fetch.side_effect = create_fake_plugin

        result = plugin_manager.install_plugin("test-owner/test-plugin")

        assert result["success"] is True
        assert result["plugin"] == "test-plugin"
        assert result["version"] == "1.0.0"

        # Verify plugin is in installed list
        plugins = plugin_manager.list_installed()
        assert len(plugins) == 1
        assert plugins[0].name == "test-plugin"

    def test_uninstall_plugin(self, plugin_manager, temp_claude_dir):
        """Test uninstalling a plugin."""
        # Create a fake installed plugin
        cache_dir = temp_claude_dir / "plugins" / "cache"
        plugin_dir = cache_dir / "test-owner" / "test-plugin" / "1.0.0"
        plugin_dir.mkdir(parents=True)

        # Create plugin.json
        plugin_json_dir = plugin_dir / ".claude-plugin"
        plugin_json_dir.mkdir()
        plugin_json = plugin_json_dir / "plugin.json"
        plugin_json.write_text(
            json.dumps(
                {
                    "name": "test-plugin",
                    "version": "1.0.0",
                    "description": "Test plugin",
                    "author": {"name": "Test Author"},
                    "repository": "https://github.com/test-owner/test-plugin",
                    "agents": [],
                    "skills": [],
                    "commands": [],
                }
            )
        )

        # Add to installed_plugins.json
        installed_file = temp_claude_dir / "plugins" / "installed_plugins.json"
        installed_file.write_text(
            json.dumps(
                {
                    "version": 2,
                    "plugins": {
                        "test-owner@test-plugin": [
                            {
                                "scope": "user",
                                "installPath": str(plugin_dir),
                                "version": "1.0.0",
                                "installedAt": "2026-01-01T00:00:00Z",
                            }
                        ]
                    },
                }
            )
        )

        # Uninstall
        result = plugin_manager.uninstall_plugin("test-plugin")

        assert result["success"] is True
        assert result["plugin"] == "test-plugin"

        # Verify plugin is removed
        plugins = plugin_manager.list_installed()
        assert len(plugins) == 0

    def test_uninstall_nonexistent_plugin(self, plugin_manager):
        """Test uninstalling a plugin that doesn't exist."""
        result = plugin_manager.uninstall_plugin("nonexistent-plugin")

        assert result["success"] is False
        assert "not installed" in result["error"]

    def test_get_plugin_details_installed(self, plugin_manager, temp_claude_dir):
        """Test getting details for an installed plugin."""
        # Create a fake installed plugin
        cache_dir = temp_claude_dir / "plugins" / "cache"
        plugin_dir = cache_dir / "test-owner" / "test-plugin" / "1.0.0"
        plugin_dir.mkdir(parents=True)

        # Create plugin.json
        plugin_json_dir = plugin_dir / ".claude-plugin"
        plugin_json_dir.mkdir()
        plugin_json = plugin_json_dir / "plugin.json"
        plugin_json.write_text(
            json.dumps(
                {
                    "name": "test-plugin",
                    "version": "1.0.0",
                    "description": "Test plugin",
                    "author": {"name": "Test Author"},
                    "repository": "https://github.com/test-owner/test-plugin",
                    "keywords": ["test", "example"],
                }
            )
        )

        # Add to installed_plugins.json
        installed_file = temp_claude_dir / "plugins" / "installed_plugins.json"
        installed_file.write_text(
            json.dumps(
                {
                    "version": 2,
                    "plugins": {
                        "test-owner@test-plugin": [
                            {
                                "scope": "user",
                                "installPath": str(plugin_dir),
                                "version": "1.0.0",
                                "installedAt": "2026-01-01T00:00:00Z",
                            }
                        ]
                    },
                }
            )
        )

        plugin = plugin_manager.get_plugin_details("test-plugin")

        assert plugin is not None
        assert plugin.name == "test-plugin"
        assert plugin.version == "1.0.0"
        assert plugin.keywords == ["test", "example"]
        assert plugin.installed is True

    def test_get_plugin_details_not_found(self, plugin_manager):
        """Test getting details for a non-existent plugin."""
        plugin = plugin_manager.get_plugin_details("nonexistent-plugin")
        assert plugin is None

    def test_search_marketplace(self, plugin_manager, temp_claude_dir):
        """Test searching marketplace with query."""
        # Create fake marketplace
        marketplace_dir = temp_claude_dir / "plugins" / "marketplaces" / "test-marketplace"
        marketplace_dir.mkdir(parents=True)

        # Add marketplace to known marketplaces
        marketplaces_file = temp_claude_dir / "plugins" / "known_marketplaces.json"
        marketplaces_file.write_text(
            json.dumps(
                {
                    "test-marketplace": {
                        "source": {"source": "github", "repo": "test/marketplace"},
                        "installLocation": str(marketplace_dir),
                    }
                }
            )
        )

        # Create a plugin in marketplace
        plugin_dir = marketplace_dir / "awesome-plugin"
        plugin_dir.mkdir()
        plugin_json_dir = plugin_dir / ".claude-plugin"
        plugin_json_dir.mkdir()
        plugin_json = plugin_json_dir / "plugin.json"
        plugin_json.write_text(
            json.dumps(
                {
                    "name": "awesome-plugin",
                    "version": "1.0.0",
                    "description": "An awesome plugin for testing",
                    "author": {"name": "Test"},
                    "repository": "",
                }
            )
        )

        # Search with matching query
        plugins = plugin_manager.list_marketplace(search="awesome")
        assert len(plugins) == 1
        assert plugins[0].name == "awesome-plugin"

        # Search with non-matching query
        plugins = plugin_manager.list_marketplace(search="nonexistent")
        assert len(plugins) == 0
