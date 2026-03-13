"""
Plugin Manager for Claude Code extensions.

Provides discovery, installation, and management of Claude Code plugins
from GitHub repositories. Integrates with Claude Code's plugin system
which stores plugins in ~/.claude/plugins/.
"""

import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger("ccplus.plugins")

CLAUDE_DIR = Path.home() / ".claude"
PLUGINS_DIR = CLAUDE_DIR / "plugins"
MARKETPLACES_DIR = PLUGINS_DIR / "marketplaces"
CACHE_DIR = PLUGINS_DIR / "cache"
INSTALLED_PLUGINS_FILE = PLUGINS_DIR / "installed_plugins.json"
KNOWN_MARKETPLACES_FILE = PLUGINS_DIR / "known_marketplaces.json"

# Official Claude Code plugin marketplaces
DEFAULT_MARKETPLACES = {
    "claude-plugins-official": {
        "source": {"source": "github", "repo": "anthropics/claude-plugins-official"},
        "installLocation": str(MARKETPLACES_DIR / "claude-plugins-official"),
    },
    "everything-claude-code": {
        "source": {"source": "github", "repo": "affaan-m/everything-claude-code"},
        "installLocation": str(MARKETPLACES_DIR / "everything-claude-code"),
    },
}


@dataclass
class Plugin:
    """Metadata for a Claude Code plugin."""

    name: str
    version: str
    description: str
    author: dict[str, str]
    repository: str
    installed: bool
    install_path: str | None = None
    installed_at: str | None = None
    homepage: str | None = None
    license: str | None = None
    keywords: list[str] | None = None
    agents: list[str] | None = None
    skills: list[str] | None = None
    commands: list[str] | None = None


class PluginManager:
    """Manage Claude Code plugins -- discovery, installation, removal."""

    def __init__(self):
        self._ensure_plugin_dirs()

    def _ensure_plugin_dirs(self) -> None:
        """Create plugin directories if they don't exist."""
        for directory in [PLUGINS_DIR, MARKETPLACES_DIR, CACHE_DIR]:
            directory.mkdir(parents=True, exist_ok=True)

        if not INSTALLED_PLUGINS_FILE.exists():
            INSTALLED_PLUGINS_FILE.write_text(
                json.dumps({"version": 2, "plugins": {}}, indent=2)
            )

        if not KNOWN_MARKETPLACES_FILE.exists():
            KNOWN_MARKETPLACES_FILE.write_text(json.dumps({}, indent=2))

    def _load_installed_plugins(self) -> dict[str, Any]:
        """Load installed plugins metadata from disk."""
        try:
            with open(INSTALLED_PLUGINS_FILE, "r") as f:
                return json.load(f)
        except Exception as exc:
            logger.error(f"Failed to load installed plugins: {exc}")
            return {"version": 2, "plugins": {}}

    def _save_installed_plugins(self, data: dict[str, Any]) -> None:
        """Save installed plugins metadata to disk."""
        try:
            with open(INSTALLED_PLUGINS_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as exc:
            logger.error(f"Failed to save installed plugins: {exc}")

    def _load_marketplaces(self) -> dict[str, Any]:
        """Load known marketplaces from disk."""
        try:
            with open(KNOWN_MARKETPLACES_FILE, "r") as f:
                return json.load(f)
        except Exception as exc:
            logger.error(f"Failed to load marketplaces: {exc}")
            return {}

    def _save_marketplaces(self, data: dict[str, Any]) -> None:
        """Save marketplaces metadata to disk."""
        try:
            with open(KNOWN_MARKETPLACES_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as exc:
            logger.error(f"Failed to save marketplaces: {exc}")

    def _fetch_github_repo(self, repo: str, target_dir: Path) -> bool:
        """Clone or update a GitHub repository.

        Args:
            repo: GitHub repo in format "owner/name"
            target_dir: Local directory to clone into

        Returns:
            True if successful, False otherwise
        """
        try:
            if target_dir.exists():
                # Update existing repo
                result = subprocess.run(
                    ["git", "pull"],
                    cwd=target_dir,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode != 0:
                    logger.error(f"Git pull failed for {repo}: {result.stderr}")
                    return False
            else:
                # Clone new repo
                result = subprocess.run(
                    [
                        "git",
                        "clone",
                        f"https://github.com/{repo}.git",
                        str(target_dir),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                if result.returncode != 0:
                    logger.error(f"Git clone failed for {repo}: {result.stderr}")
                    return False

            return True
        except Exception as exc:
            logger.error(f"Failed to fetch GitHub repo {repo}: {exc}")
            return False

    def _parse_plugin_json(self, plugin_dir: Path) -> dict[str, Any] | None:
        """Parse plugin.json metadata from a plugin directory.

        Args:
            plugin_dir: Path to plugin root

        Returns:
            Plugin metadata dict or None if not found/invalid
        """
        plugin_json = plugin_dir / ".claude-plugin" / "plugin.json"
        if not plugin_json.exists():
            # Fallback: check for plugin.json at root
            plugin_json = plugin_dir / "plugin.json"

        if not plugin_json.exists():
            return None

        try:
            with open(plugin_json, "r") as f:
                return json.load(f)
        except Exception as exc:
            logger.error(f"Failed to parse plugin.json at {plugin_json}: {exc}")
            return None

    def refresh_marketplaces(self) -> dict[str, bool]:
        """Update all known marketplaces from their sources.

        Returns:
            Dict mapping marketplace name to success status
        """
        marketplaces = self._load_marketplaces()
        results = {}

        # Ensure default marketplaces are registered
        for name, config in DEFAULT_MARKETPLACES.items():
            if name not in marketplaces:
                marketplaces[name] = config

        for name, config in marketplaces.items():
            source = config.get("source", {})
            if source.get("source") == "github":
                repo = source.get("repo")
                install_loc = Path(config.get("installLocation", ""))
                if repo and install_loc:
                    success = self._fetch_github_repo(repo, install_loc)
                    if success:
                        config["lastUpdated"] = datetime.now(timezone.utc).isoformat() + "Z"
                    results[name] = success
                else:
                    results[name] = False
            else:
                results[name] = False

        self._save_marketplaces(marketplaces)
        return results

    def list_installed(self) -> list[Plugin]:
        """List all installed plugins.

        Returns:
            List of Plugin objects for installed plugins
        """
        installed_data = self._load_installed_plugins()
        plugins = []

        for plugin_key, installations in installed_data.get("plugins", {}).items():
            if not installations:
                continue

            # Get the first installation (user scope)
            install = installations[0]
            install_path = Path(install.get("installPath", ""))

            if not install_path.exists():
                continue

            metadata = self._parse_plugin_json(install_path)
            if not metadata:
                # Create minimal metadata from installation record
                name = plugin_key.split("@")[-1]
                plugins.append(
                    Plugin(
                        name=name,
                        version=install.get("version", "unknown"),
                        description="No description available",
                        author={"name": "Unknown"},
                        repository="",
                        installed=True,
                        install_path=str(install_path),
                        installed_at=install.get("installedAt"),
                    )
                )
                continue

            plugins.append(
                Plugin(
                    name=metadata.get("name", "unknown"),
                    version=metadata.get("version", install.get("version", "unknown")),
                    description=metadata.get("description", ""),
                    author=metadata.get("author", {"name": "Unknown"}),
                    repository=metadata.get("repository", ""),
                    installed=True,
                    install_path=str(install_path),
                    installed_at=install.get("installedAt"),
                    homepage=metadata.get("homepage"),
                    license=metadata.get("license"),
                    keywords=metadata.get("keywords"),
                    agents=metadata.get("agents"),
                    skills=metadata.get("skills"),
                    commands=metadata.get("commands"),
                )
            )

        return plugins

    def list_marketplace(self, search: str | None = None) -> list[Plugin]:
        """List available plugins from all marketplaces.

        Args:
            search: Optional search query to filter plugins

        Returns:
            List of Plugin objects available in marketplaces
        """
        # Refresh marketplaces first
        self.refresh_marketplaces()

        marketplaces = self._load_marketplaces()
        installed = {p.name for p in self.list_installed()}
        plugins = []

        for name, config in marketplaces.items():
            install_loc = Path(config.get("installLocation", ""))
            if not install_loc.exists():
                continue

            # Scan for plugins in marketplace
            # Look for .claude-plugin/plugin.json files
            for plugin_dir in install_loc.iterdir():
                if not plugin_dir.is_dir():
                    continue

                metadata = self._parse_plugin_json(plugin_dir)
                if not metadata:
                    continue

                plugin_name = metadata.get("name", "")
                if search and search.lower() not in plugin_name.lower() and search.lower() not in metadata.get("description", "").lower():
                    continue

                plugins.append(
                    Plugin(
                        name=plugin_name,
                        version=metadata.get("version", "latest"),
                        description=metadata.get("description", ""),
                        author=metadata.get("author", {"name": "Unknown"}),
                        repository=metadata.get("repository", ""),
                        installed=plugin_name in installed,
                        homepage=metadata.get("homepage"),
                        license=metadata.get("license"),
                        keywords=metadata.get("keywords"),
                        agents=metadata.get("agents"),
                        skills=metadata.get("skills"),
                        commands=metadata.get("commands"),
                    )
                )

        return plugins

    def install_plugin(self, identifier: str) -> dict[str, Any]:
        """Install a plugin from GitHub or marketplace.

        Args:
            identifier: GitHub repo (owner/name) or plugin name

        Returns:
            Dict with success status and message
        """
        try:
            # Check if identifier is a GitHub repo
            if "/" in identifier:
                return self._install_from_github(identifier)
            else:
                return self._install_from_marketplace(identifier)
        except Exception as exc:
            logger.error(f"Plugin installation failed: {exc}")
            return {"success": False, "error": str(exc)}

    def _install_from_github(self, repo: str) -> dict[str, Any]:
        """Install a plugin directly from a GitHub repository.

        Args:
            repo: GitHub repo in format "owner/name"

        Returns:
            Dict with success status and message
        """
        # Parse repo name
        parts = repo.split("/")
        if len(parts) != 2:
            return {"success": False, "error": "Invalid GitHub repo format"}

        owner, name = parts

        # Clone to temporary location first
        temp_dir = CACHE_DIR / owner / name / "temp"
        temp_dir.parent.mkdir(parents=True, exist_ok=True)

        if not self._fetch_github_repo(repo, temp_dir):
            return {"success": False, "error": "Failed to clone repository"}

        # Parse plugin metadata
        metadata = self._parse_plugin_json(temp_dir)
        if not metadata:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return {"success": False, "error": "No plugin.json found in repository"}

        plugin_name = metadata.get("name", name)
        version = metadata.get("version", "1.0.0")

        # Move to final location
        install_path = CACHE_DIR / owner / plugin_name / version
        if install_path.exists():
            shutil.rmtree(install_path, ignore_errors=True)

        install_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(temp_dir), str(install_path))

        # Update installed plugins registry
        installed_data = self._load_installed_plugins()
        plugin_key = f"{owner}@{plugin_name}"

        installed_data["plugins"][plugin_key] = [
            {
                "scope": "user",
                "installPath": str(install_path),
                "version": version,
                "installedAt": datetime.now(timezone.utc).isoformat() + "Z",
                "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
            }
        ]

        self._save_installed_plugins(installed_data)

        # Copy agents, skills, commands to Claude directories
        self._link_plugin_resources(install_path, metadata)

        return {
            "success": True,
            "plugin": plugin_name,
            "version": version,
            "install_path": str(install_path),
        }

    def _install_from_marketplace(self, plugin_name: str) -> dict[str, Any]:
        """Install a plugin from a known marketplace.

        Args:
            plugin_name: Name of the plugin

        Returns:
            Dict with success status and message
        """
        # Search marketplaces for the plugin
        marketplaces = self._load_marketplaces()

        for marketplace_name, config in marketplaces.items():
            install_loc = Path(config.get("installLocation", ""))
            if not install_loc.exists():
                continue

            plugin_dir = install_loc / plugin_name
            if plugin_dir.exists():
                metadata = self._parse_plugin_json(plugin_dir)
                if metadata and metadata.get("name") == plugin_name:
                    # Found it! Install from marketplace cache
                    version = metadata.get("version", "1.0.0")
                    install_path = CACHE_DIR / marketplace_name / plugin_name / version

                    if install_path.exists():
                        shutil.rmtree(install_path, ignore_errors=True)

                    install_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(plugin_dir, install_path)

                    # Update registry
                    installed_data = self._load_installed_plugins()
                    plugin_key = f"{marketplace_name}@{plugin_name}"

                    installed_data["plugins"][plugin_key] = [
                        {
                            "scope": "user",
                            "installPath": str(install_path),
                            "version": version,
                            "installedAt": datetime.now(timezone.utc).isoformat() + "Z",
                            "lastUpdated": datetime.now(timezone.utc).isoformat() + "Z",
                        }
                    ]

                    self._save_installed_plugins(installed_data)

                    # Link resources
                    self._link_plugin_resources(install_path, metadata)

                    return {
                        "success": True,
                        "plugin": plugin_name,
                        "version": version,
                        "install_path": str(install_path),
                    }

        return {"success": False, "error": f"Plugin '{plugin_name}' not found in any marketplace"}

    def _link_plugin_resources(self, install_path: Path, metadata: dict[str, Any]) -> None:
        """Create symlinks for plugin agents, skills, and commands in Claude directories.

        Args:
            install_path: Path where plugin is installed
            metadata: Plugin metadata dict
        """
        # Link agents
        agents = metadata.get("agents", [])
        if agents:
            agents_dir = CLAUDE_DIR / "agents"
            agents_dir.mkdir(parents=True, exist_ok=True)

            for agent_path in agents:
                agent_file = install_path / agent_path.lstrip("./")
                if agent_file.exists():
                    link_name = agents_dir / agent_file.name
                    if link_name.exists() or link_name.is_symlink():
                        link_name.unlink()
                    try:
                        link_name.symlink_to(agent_file)
                    except Exception as exc:
                        logger.warning(f"Failed to link agent {agent_file.name}: {exc}")

        # Link skills
        skills = metadata.get("skills", [])
        if skills:
            skills_dir = CLAUDE_DIR / "skills"
            skills_dir.mkdir(parents=True, exist_ok=True)

            for skill_path in skills:
                skill_file = install_path / skill_path.lstrip("./")
                if skill_file.is_dir():
                    # Copy directory contents
                    for item in skill_file.iterdir():
                        link_name = skills_dir / item.name
                        if link_name.exists() or link_name.is_symlink():
                            if link_name.is_dir():
                                shutil.rmtree(link_name)
                            else:
                                link_name.unlink()
                        try:
                            if item.is_dir():
                                shutil.copytree(item, link_name, symlinks=True)
                            else:
                                link_name.symlink_to(item)
                        except Exception as exc:
                            logger.warning(f"Failed to link skill {item.name}: {exc}")
                elif skill_file.exists():
                    link_name = skills_dir / skill_file.name
                    if link_name.exists() or link_name.is_symlink():
                        link_name.unlink()
                    try:
                        link_name.symlink_to(skill_file)
                    except Exception as exc:
                        logger.warning(f"Failed to link skill {skill_file.name}: {exc}")

        # Link commands
        commands = metadata.get("commands", [])
        if commands:
            commands_dir = CLAUDE_DIR / "commands"
            commands_dir.mkdir(parents=True, exist_ok=True)

            for command_path in commands:
                command_file = install_path / command_path.lstrip("./")
                if command_file.is_dir():
                    # Copy directory contents
                    for item in command_file.iterdir():
                        link_name = commands_dir / item.name
                        if link_name.exists() or link_name.is_symlink():
                            if link_name.is_dir():
                                shutil.rmtree(link_name)
                            else:
                                link_name.unlink()
                        try:
                            if item.is_dir():
                                shutil.copytree(item, link_name, symlinks=True)
                            else:
                                link_name.symlink_to(item)
                        except Exception as exc:
                            logger.warning(f"Failed to link command {item.name}: {exc}")
                elif command_file.exists():
                    link_name = commands_dir / command_file.name
                    if link_name.exists() or link_name.is_symlink():
                        link_name.unlink()
                    try:
                        link_name.symlink_to(command_file)
                    except Exception as exc:
                        logger.warning(f"Failed to link command {command_file.name}: {exc}")

    def uninstall_plugin(self, name: str) -> dict[str, Any]:
        """Uninstall a plugin.

        Args:
            name: Plugin name

        Returns:
            Dict with success status and message
        """
        installed_data = self._load_installed_plugins()
        plugins = installed_data.get("plugins", {})

        # Find the plugin
        plugin_key = None
        for key in plugins.keys():
            if key.endswith(f"@{name}"):
                plugin_key = key
                break

        if not plugin_key:
            return {"success": False, "error": f"Plugin '{name}' is not installed"}

        installations = plugins[plugin_key]
        if not installations:
            return {"success": False, "error": f"Plugin '{name}' has no installation records"}

        install_path = Path(installations[0].get("installPath", ""))

        # Parse metadata to know what to unlink
        metadata = self._parse_plugin_json(install_path)
        if metadata:
            self._unlink_plugin_resources(install_path, metadata)

        # Remove installation directory
        if install_path.exists():
            shutil.rmtree(install_path, ignore_errors=True)

        # Remove from registry
        del plugins[plugin_key]
        self._save_installed_plugins(installed_data)

        return {"success": True, "plugin": name}

    def _unlink_plugin_resources(self, install_path: Path, metadata: dict[str, Any]) -> None:
        """Remove symlinks for plugin resources.

        Args:
            install_path: Path where plugin is installed
            metadata: Plugin metadata dict
        """
        # Unlink agents
        agents = metadata.get("agents", [])
        agents_dir = CLAUDE_DIR / "agents"
        for agent_path in agents:
            agent_file = install_path / agent_path.lstrip("./")
            link_name = agents_dir / agent_file.name
            if link_name.is_symlink() or link_name.exists():
                try:
                    link_name.unlink()
                except Exception as exc:
                    logger.warning(f"Failed to unlink agent {link_name.name}: {exc}")

        # Unlink skills
        skills = metadata.get("skills", [])
        skills_dir = CLAUDE_DIR / "skills"
        for skill_path in skills:
            skill_file = install_path / skill_path.lstrip("./")
            if skill_file.is_dir():
                for item in skill_file.iterdir():
                    link_name = skills_dir / item.name
                    if link_name.exists() or link_name.is_symlink():
                        try:
                            if link_name.is_dir():
                                shutil.rmtree(link_name)
                            else:
                                link_name.unlink()
                        except Exception as exc:
                            logger.warning(f"Failed to unlink skill {item.name}: {exc}")
            else:
                link_name = skills_dir / skill_file.name
                if link_name.is_symlink() or link_name.exists():
                    try:
                        link_name.unlink()
                    except Exception as exc:
                        logger.warning(f"Failed to unlink skill {link_name.name}: {exc}")

        # Unlink commands
        commands = metadata.get("commands", [])
        commands_dir = CLAUDE_DIR / "commands"
        for command_path in commands:
            command_file = install_path / command_path.lstrip("./")
            if command_file.is_dir():
                for item in command_file.iterdir():
                    link_name = commands_dir / item.name
                    if link_name.exists() or link_name.is_symlink():
                        try:
                            if link_name.is_dir():
                                shutil.rmtree(link_name)
                            else:
                                link_name.unlink()
                        except Exception as exc:
                            logger.warning(f"Failed to unlink command {item.name}: {exc}")
            else:
                link_name = commands_dir / command_file.name
                if link_name.is_symlink() or link_name.exists():
                    try:
                        link_name.unlink()
                    except Exception as exc:
                        logger.warning(f"Failed to unlink command {link_name.name}: {exc}")

    def get_plugin_details(self, name: str) -> Plugin | None:
        """Get detailed information about a specific plugin.

        Args:
            name: Plugin name

        Returns:
            Plugin object or None if not found
        """
        # Check installed first
        for plugin in self.list_installed():
            if plugin.name == name:
                return plugin

        # Check marketplace
        for plugin in self.list_marketplace():
            if plugin.name == name:
                return plugin

        return None
