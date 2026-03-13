"""
Plugin management module for ccplus.

Wraps Claude CLI commands to manage plugins and expose their metadata
through HTTP APIs. Provides functionality for:
- Listing installed plugins
- Browsing marketplace plugins
- Installing and uninstalling plugins
- Discovering skills provided by plugins
"""

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger("ccplus.plugins")


class PluginManager:
    """Manages Claude Code plugins via CLI wrapper."""

    def __init__(self):
        """Initialize the plugin manager."""
        self.claude_bin = self._find_claude_binary()

    def _find_claude_binary(self) -> str:
        """Find the Claude CLI binary path."""
        # Try common locations
        for path in [
            Path.home() / ".local" / "bin" / "claude",
            Path("/usr/local/bin/claude"),
            Path("/opt/homebrew/bin/claude"),
        ]:
            if path.exists():
                logger.info(f"Found Claude CLI at {path}")
                return str(path)

        # Fall back to PATH
        try:
            result = subprocess.run(
                ["which", "claude"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                path = result.stdout.strip()
                logger.info(f"Found Claude CLI in PATH: {path}")
                return path
        except Exception as exc:
            logger.warning(f"Failed to locate Claude CLI: {exc}")

        # Default fallback
        return "claude"

    def _run_command(self, args: list[str], timeout: int = 30) -> dict[str, Any]:
        """Run a Claude CLI command and return parsed JSON output.

        Args:
            args: Command arguments (e.g., ["plugin", "list", "--json"])
            timeout: Command timeout in seconds

        Returns:
            Parsed JSON output or error dict
        """
        try:
            cmd = [self.claude_bin] + args
            logger.debug(f"Running command: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip()
                logger.error(f"Command failed: {error_msg}")
                return {"error": error_msg, "success": False}

            output = result.stdout.strip()
            if not output:
                return {"success": True, "data": []}

            try:
                return {"success": True, "data": json.loads(output)}
            except json.JSONDecodeError as exc:
                logger.error(f"Failed to parse JSON: {exc}")
                return {"success": False, "error": f"Invalid JSON response: {exc}"}

        except subprocess.TimeoutExpired:
            logger.error(f"Command timed out after {timeout}s")
            return {"success": False, "error": "Command timed out"}
        except Exception as exc:
            logger.error(f"Command execution failed: {exc}")
            return {"success": False, "error": str(exc)}

    def list_installed(self) -> dict[str, Any]:
        """List all installed plugins.

        Returns:
            Dict with 'success' and 'data' (list of plugin dicts) or 'error'
        """
        result = self._run_command(["plugin", "list", "--json"])
        if not result.get("success"):
            return result

        # Enrich plugin data with metadata from manifest files
        plugins = []
        for plugin_data in result.get("data", []):
            enriched = self._enrich_plugin_data(plugin_data)
            plugins.append(enriched)

        return {"success": True, "data": plugins}

    def list_marketplaces(self) -> dict[str, Any]:
        """List all configured marketplaces.

        Returns:
            Dict with 'success' and 'data' (list of marketplace dicts) or 'error'
        """
        return self._run_command(["plugin", "marketplace", "list", "--json"])

    def list_marketplace_plugins(self, search: str | None = None) -> dict[str, Any]:
        """List all available plugins from all marketplaces.

        Args:
            search: Optional search query to filter plugins

        Returns:
            Dict with 'success' and 'data' (list of plugin dicts) or 'error'
        """
        # Get installed plugins first to mark them
        installed_result = self.list_installed()
        installed_ids = set()
        if installed_result.get("success"):
            installed_ids = {p.get("id", p.get("name")) for p in installed_result.get("data", [])}

        # Get marketplaces
        marketplaces_result = self.list_marketplaces()
        if not marketplaces_result.get("success"):
            return marketplaces_result

        all_plugins = []
        for marketplace in marketplaces_result.get("data", []):
            install_location = Path(marketplace.get("installLocation", ""))
            if not install_location.exists():
                continue

            # Read marketplace manifest
            marketplace_manifest = install_location / ".claude-plugin" / "marketplace.json"
            if not marketplace_manifest.exists():
                continue

            try:
                with open(marketplace_manifest) as f:
                    manifest = json.load(f)

                for plugin in manifest.get("plugins", []):
                    plugin_name = plugin.get("name")
                    plugin_id = f"{plugin_name}@{marketplace['name']}"

                    # Skip if search query doesn't match
                    if search:
                        search_lower = search.lower()
                        if not any([
                            search_lower in plugin_name.lower(),
                            search_lower in plugin.get("description", "").lower(),
                            search_lower in " ".join(plugin.get("tags", [])).lower(),
                        ]):
                            continue

                    # Format plugin data
                    formatted = {
                        "name": plugin_name,
                        "version": plugin.get("version", "unknown"),
                        "description": plugin.get("description", ""),
                        "author": plugin.get("author", {"name": "Unknown"}),
                        "repository": f"https://github.com/{marketplace.get('repo', '')}",
                        "homepage": plugin.get("homepage", ""),
                        "license": plugin.get("license", ""),
                        "keywords": plugin.get("tags", []),
                        "installed": plugin_id in installed_ids or plugin_name in installed_ids,
                        "marketplace": marketplace["name"],
                    }

                    # Add skills/agents/commands if available
                    if formatted["installed"]:
                        # Try to get details from installed plugin
                        for installed_plugin in installed_result.get("data", []):
                            if installed_plugin.get("name") == plugin_name:
                                formatted["skills"] = installed_plugin.get("skills", [])
                                formatted["agents"] = installed_plugin.get("agents", [])
                                formatted["commands"] = installed_plugin.get("commands", [])
                                formatted["install_path"] = installed_plugin.get("install_path")
                                formatted["installed_at"] = installed_plugin.get("installed_at")
                                break

                    all_plugins.append(formatted)

            except Exception as exc:
                logger.error(f"Failed to read marketplace {marketplace['name']}: {exc}")
                continue

        # Sort by name
        all_plugins.sort(key=lambda p: p["name"])

        return {"success": True, "data": all_plugins}

    def install_plugin(self, identifier: str) -> dict[str, Any]:
        """Install a plugin from a marketplace.

        Args:
            identifier: Plugin identifier (name or name@marketplace)

        Returns:
            Dict with 'success' and installation details or 'error'
        """
        result = self._run_command(["plugin", "install", identifier], timeout=120)
        if not result.get("success"):
            return result

        # Return success with plugin info
        return {
            "success": True,
            "plugin": identifier.split("@")[0],
            "message": f"Successfully installed {identifier}",
        }

    def uninstall_plugin(self, name: str) -> dict[str, Any]:
        """Uninstall an installed plugin.

        Args:
            name: Plugin name

        Returns:
            Dict with 'success' and uninstallation details or 'error'
        """
        result = self._run_command(["plugin", "uninstall", name], timeout=60)
        if not result.get("success"):
            return result

        return {
            "success": True,
            "plugin": name,
            "message": f"Successfully uninstalled {name}",
        }

    def get_plugin_skills(self, name: str) -> dict[str, Any]:
        """Get all skills provided by a specific plugin.

        Args:
            name: Plugin name

        Returns:
            Dict with 'success' and 'skills' list or 'error'
        """
        # Get installed plugins
        result = self.list_installed()
        if not result.get("success"):
            return result

        # Find the plugin
        for plugin in result.get("data", []):
            if plugin.get("name") == name:
                return {
                    "success": True,
                    "skills": plugin.get("skills", []),
                }

        return {
            "success": False,
            "error": f"Plugin '{name}' not found or not installed",
        }

    def get_all_skills(self) -> dict[str, Any]:
        """Get all skills from all installed plugins.

        Returns:
            Dict with 'success' and 'skills' list (each with plugin info) or 'error'
        """
        result = self.list_installed()
        if not result.get("success"):
            return result

        all_skills = []
        for plugin in result.get("data", []):
            plugin_name = plugin.get("name")
            for skill in plugin.get("skills", []):
                all_skills.append({
                    "name": skill,
                    "plugin": plugin_name,
                    "plugin_version": plugin.get("version"),
                })

        return {"success": True, "skills": all_skills}

    def _enrich_plugin_data(self, plugin_data: dict[str, Any]) -> dict[str, Any]:
        """Enrich plugin data with manifest information.

        Args:
            plugin_data: Raw plugin data from CLI

        Returns:
            Enriched plugin data with skills, agents, commands
        """
        install_path = Path(plugin_data.get("installPath", ""))
        if not install_path.exists():
            return {
                **plugin_data,
                "name": plugin_data.get("id", "").split("@")[0],
                "author": {"name": "Unknown"},
                "skills": [],
                "agents": [],
                "commands": [],
            }

        # Read plugin manifest
        plugin_manifest = install_path / ".claude-plugin" / "plugin.json"
        if not plugin_manifest.exists():
            return {
                **plugin_data,
                "name": plugin_data.get("id", "").split("@")[0],
                "author": {"name": "Unknown"},
                "skills": [],
                "agents": [],
                "commands": [],
            }

        try:
            with open(plugin_manifest) as f:
                manifest = json.load(f)

            # Get skills directory
            skills_path = install_path / ".claude" / "skills"
            skills = []
            if skills_path.exists():
                skills = [d.name for d in skills_path.iterdir() if d.is_dir()]

            # Get agents directory
            agents_path = install_path / ".claude" / "agents"
            agents = []
            if agents_path.exists():
                agents = [f.stem for f in agents_path.glob("*.md")]

            # Commands are typically documented in README or manifest
            commands = []

            return {
                "name": manifest.get("name"),
                "version": manifest.get("version"),
                "description": manifest.get("description", ""),
                "author": manifest.get("author", {"name": "Unknown"}),
                "repository": manifest.get("repository", ""),
                "homepage": manifest.get("homepage", ""),
                "license": manifest.get("license", ""),
                "enabled": plugin_data.get("enabled", True),
                "installed": True,
                "install_path": str(install_path),
                "installed_at": plugin_data.get("installedAt", ""),
                "skills": sorted(skills),
                "agents": sorted(agents),
                "commands": commands,
            }
        except Exception as exc:
            logger.error(f"Failed to enrich plugin data for {install_path}: {exc}")
            return {
                **plugin_data,
                "name": plugin_data.get("id", "").split("@")[0],
                "author": {"name": "Unknown"},
                "skills": [],
                "agents": [],
                "commands": [],
            }
