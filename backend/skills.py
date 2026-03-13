"""
Skill execution module for ccplus.

Wraps Claude CLI skill commands to enable slash command execution
from the chat interface. Provides functionality for:
- Executing skills with arguments
- Parsing skill metadata
- Handling skill errors
"""

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger("ccplus.skills")


class SkillExecutor:
    """Executes Claude Code skills via CLI wrapper."""

    def __init__(self):
        """Initialize the skill executor."""
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

    def _run_command(self, args: list[str], timeout: int = 60) -> dict[str, Any]:
        """Run a Claude CLI command and return parsed output.

        Args:
            args: Command arguments (e.g., ["skill", "exec", "polish", "--"])
            timeout: Command timeout in seconds

        Returns:
            Dict with success status, output, and error if any
        """
        try:
            cmd = [self.claude_bin] + args
            logger.info(f"Running command: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip()
                logger.error(f"Command failed: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "output": result.stdout.strip(),
                }

            output = result.stdout.strip()
            return {
                "success": True,
                "output": output,
            }

        except subprocess.TimeoutExpired:
            logger.error(f"Command timed out after {timeout}s")
            return {"success": False, "error": f"Skill execution timed out after {timeout}s"}
        except Exception as exc:
            logger.error(f"Command execution failed: {exc}")
            return {"success": False, "error": str(exc)}

    def execute_skill(self, skill_name: str, arguments: str = "", workspace: str = None) -> dict[str, Any]:
        """Execute a skill with optional arguments.

        Args:
            skill_name: Name of the skill to execute
            arguments: Optional arguments string to pass to the skill
            workspace: Optional workspace path to execute in

        Returns:
            Dict with success status, output, and error if any
        """
        # Build command args
        cmd_args = ["skill", "exec", skill_name]

        if arguments:
            # Append arguments after --
            cmd_args.extend(["--", arguments])

        # Execute with workspace if provided
        env = None
        if workspace:
            env = {"PWD": workspace}

        try:
            cmd = [self.claude_bin] + cmd_args
            logger.info(f"Executing skill: {skill_name} with args: {arguments}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                env=env,
                cwd=workspace,
            )

            output = result.stdout.strip()
            error = result.stderr.strip()

            if result.returncode != 0:
                logger.error(f"Skill execution failed: {error or output}")
                return {
                    "success": False,
                    "error": error or output or "Skill execution failed",
                    "output": output,
                    "skill": skill_name,
                }

            return {
                "success": True,
                "output": output,
                "skill": skill_name,
            }

        except subprocess.TimeoutExpired:
            logger.error(f"Skill execution timed out: {skill_name}")
            return {
                "success": False,
                "error": f"Skill '{skill_name}' timed out after 60 seconds",
                "skill": skill_name,
            }
        except Exception as exc:
            logger.error(f"Skill execution error: {exc}")
            return {
                "success": False,
                "error": str(exc),
                "skill": skill_name,
            }

    def get_skill_list(self) -> dict[str, Any]:
        """Get list of all available skills with metadata.

        Returns:
            Dict with success status and skills list
        """
        result = self._run_command(["skill", "list", "--json"])
        if not result.get("success"):
            return result

        try:
            skills_data = json.loads(result.get("output", "[]"))
            return {"success": True, "skills": skills_data}
        except json.JSONDecodeError as exc:
            logger.error(f"Failed to parse skills list: {exc}")
            return {"success": False, "error": f"Invalid JSON response: {exc}"}

    def get_skill_info(self, skill_name: str) -> dict[str, Any]:
        """Get detailed information about a specific skill.

        Args:
            skill_name: Name of the skill

        Returns:
            Dict with success status and skill metadata
        """
        result = self._run_command(["skill", "info", skill_name, "--json"])
        if not result.get("success"):
            return result

        try:
            skill_info = json.loads(result.get("output", "{}"))
            return {"success": True, "skill": skill_info}
        except json.JSONDecodeError as exc:
            logger.error(f"Failed to parse skill info: {exc}")
            return {"success": False, "error": f"Invalid JSON response: {exc}"}
