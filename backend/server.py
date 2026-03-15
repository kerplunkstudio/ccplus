"""
ccplus Server -- Web UI for Claude Code.

Flask + SocketIO server that pipes chat messages to Claude Code SDK
and streams responses + tool events back in real-time.

Architecture:
    - HTTP routes handle auth, history, stats, and static file serving
    - WebSocket (SocketIO) handles real-time chat: user messages go to the
      SDK via SessionManager, responses stream back as text_delta / tool_event
    - Threading async_mode avoids eventlet/gevent conflicts with asyncio
      (the SDK session manager runs its own asyncio loop internally)
"""

import json
import logging
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

# Remove CLAUDECODE env var to allow SDK subprocess spawning
# (otherwise Claude Code detects "nested session" and refuses to start)
os.environ.pop("CLAUDECODE", None)

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, disconnect, emit, join_room

# Add parent to path so ``backend.*`` imports resolve when running directly
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.auth import auto_login, verify_token
from backend.config import (
    DATABASE_PATH,
    HOST,
    LOCAL_MODE,
    LOG_DIR,
    PORT,
    SECRET_KEY,
    STATIC_DIR,
    WORKSPACE_PATH,
)
from backend.database import (
    archive_session,
    get_conversation_history,
    get_image,
    get_insights,
    get_sessions_list,
    get_stats,
    get_tool_events,
    get_user_stats,
    get_workspace_state,
    increment_user_stats,
    is_first_run,
    mark_orphaned_tool_events,
    record_message,
    save_workspace_state,
    store_image,
)
from backend.plugins import PluginManager
from backend.sdk_session import SessionManager

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(str(LOG_DIR / "server.log")),
    ],
)
logger = logging.getLogger("ccplus")

# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=str(STATIC_DIR))
app.secret_key = SECRET_KEY

ALLOWED_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:4000,http://localhost:4001,http://localhost:3001,http://127.0.0.1:4000,http://127.0.0.1:4001,http://127.0.0.1:3001"
).split(",")

CORS(app, origins=ALLOWED_ORIGINS)

socketio = SocketIO(
    app,
    async_mode="threading",
    cors_allowed_origins=ALLOWED_ORIGINS,
    ping_timeout=60,
    ping_interval=25,
)

session_manager = SessionManager()
plugin_manager = PluginManager()

START_TIME = time.time()

# Mark orphaned tool events from previous run
_orphan_count = mark_orphaned_tool_events()
if _orphan_count:
    logger.info(f"Marked {_orphan_count} orphaned tool events from previous run")

# Maps SocketIO request.sid -> {session_id, user_id}
connected_clients: dict[str, dict] = {}


def _handle_worker_reconnect(session_id: str):
    """Auto-register SocketIO callbacks when worker reconnects with active sessions."""
    logger.info(f"Auto-registering callbacks for active session {session_id} after worker reconnect")

    def on_text(text: str) -> None:
        socketio.emit("text_delta", {"text": text}, room=session_id)

    def on_tool_event(event: dict) -> None:
        socketio.emit("tool_event", event, room=session_id)
        # Count lines of code from Write and Edit tools
        if event.get("type") == "tool_complete" and event.get("tool_name") in ("Write", "Edit"):
            params = event.get("parameters", {})
            content = ""
            if isinstance(params, dict):
                content = params.get("content", "") or params.get("new_string", "")
            if content:
                lines = content.count("\n") + 1
                try:
                    increment_user_stats(user_id="local", lines_of_code=lines)
                except Exception as e:
                    logger.error(f"Failed to increment LOC: {e}")

    def on_complete(result: dict) -> None:
        try:
            increment_user_stats(
                user_id="local",
                queries=1,
                duration_ms=result.get("duration_ms") or 0,
                cost=result.get("cost") or 0,
                input_tokens=result.get("input_tokens") or 0,
                output_tokens=result.get("output_tokens") or 0,
            )
        except Exception as e:
            logger.error(f"Failed to increment user stats: {e}")

        socketio.emit(
            "response_complete",
            {
                "cost": result.get("cost"),
                "duration_ms": result.get("duration_ms"),
                "input_tokens": result.get("input_tokens"),
                "output_tokens": result.get("output_tokens"),
                "model": result.get("model"),
                "sdk_session_id": result.get("sdk_session_id"),
                "content": result.get("text"),
            },
            room=session_id,
        )

    def on_error(error_msg: str) -> None:
        socketio.emit("error", {"message": error_msg}, room=session_id)

    def on_user_question(data: dict) -> None:
        socketio.emit("user_question", {
            "questions": data.get("questions", []),
            "tool_use_id": data.get("tool_use_id", ""),
        }, room=session_id)

    session_manager.register_streaming_callbacks(
        session_id,
        on_text=on_text,
        on_tool_event=on_tool_event,
        on_complete=on_complete,
        on_error=on_error,
        on_user_question=on_user_question,
    )

    # Notify any connected browser clients that streaming is active
    socketio.emit("stream_active", {}, room=session_id)

    # Re-emit pending question if worker has one waiting
    pq = session_manager.get_pending_question(session_id)
    if pq:
        socketio.emit("user_question", {
            "questions": pq.get("questions", []),
            "tool_use_id": pq.get("tool_use_id", ""),
        }, room=session_id)
        logger.info(f"Re-emitted pending question for session {session_id}")


def _handle_session_lost(session_id: str):
    """Notify browser when a session's query was lost due to worker restart."""
    logger.warning(f"Session {session_id} lost due to worker restart")

    # Mark any orphaned tool events in DB
    orphan_count = mark_orphaned_tool_events()
    if orphan_count:
        logger.info(f"Marked {orphan_count} orphaned tool events after worker restart")

    # Send error message so user knows what happened
    socketio.emit("error", {
        "message": "The worker process restarted. Your query was interrupted. You can resend your message."
    }, room=session_id)

    # Send final response_complete to clear streaming state
    socketio.emit("response_complete", {
        "sdk_session_id": "worker_restart",
        "cost": None,
        "duration_ms": None,
        "input_tokens": None,
        "output_tokens": None,
        "model": None,
    }, room=session_id)


session_manager.on_session_reconnect = _handle_worker_reconnect
session_manager.on_session_lost = _handle_session_lost


# =========================================================================
# HTTP Routes
# =========================================================================


@app.route("/")
def index():
    """Serve the chat interface (React SPA)."""
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/<path:path>")
def static_files(path):
    """Serve static assets (JS bundles, CSS, images, etc.)."""
    return send_from_directory(str(STATIC_DIR), path)


@app.route("/health")
def health():
    """Health check for monitoring and load balancers.

    Returns uptime, active session count, connected WebSocket clients,
    and database-level aggregate stats.
    """
    try:
        db_stats = get_stats()
    except Exception:
        db_stats = {}

    return jsonify({
        "status": "ok",
        "uptime_seconds": int(time.time() - START_TIME),
        "active_sessions": len(session_manager.get_active_sessions()),
        "connected_clients": len(connected_clients),
        "worker_connected": session_manager.worker_connected,
        "db": db_stats,
    })


# -- Auth -----------------------------------------------------------------


@app.route("/api/auth/auto-login", methods=["POST"])
def auth_auto_login():
    """Auto-login for local single-user mode.

    Returns a short-lived JWT. Only available when LOCAL_MODE is enabled
    (the default for development).
    """
    if not LOCAL_MODE:
        return jsonify({"error": "Auto-login disabled in production mode"}), 403

    token = auto_login()
    if not token:
        return jsonify({"error": "Failed to generate token"}), 500

    return jsonify({
        "token": token,
        "user": {"id": "local", "username": "local"},
    })


@app.route("/api/auth/verify", methods=["POST"])
def auth_verify():
    """Verify a JWT and return the associated user info."""
    body = request.get_json(silent=True) or {}
    token = body.get("token", "")

    user_id = verify_token(token)
    if not user_id:
        return jsonify({"valid": False}), 401

    return jsonify({
        "valid": True,
        "user": {"id": user_id, "username": user_id},
    })


# -- Status -----------------------------------------------------------------


@app.route("/api/status/first-run")
def first_run_status():
    """Check if this is the user's first run (no conversations yet).

    Requires authentication.
    """
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        return jsonify({"error": "Unauthorized"}), 401

    return jsonify({"first_run": is_first_run()})


# -- Data -----------------------------------------------------------------


@app.route("/api/history/<session_id>")
def get_history(session_id):
    """Return conversation history for a session.

    TODO: verify the session belongs to the authenticated user.
    """
    try:
        messages = get_conversation_history(session_id)
        return jsonify({
            "messages": messages,
            "streaming": session_manager.is_active(session_id),
        })
    except Exception as exc:
        logger.error(f"Failed to fetch history for {session_id}: {exc}")
        return jsonify({"error": "Failed to load history"}), 500


@app.route("/api/activity/<session_id>")
def get_activity(session_id):
    """Return tool usage events for a session (for activity tree reconstruction)."""
    try:
        events = get_tool_events(session_id)
        return jsonify({"events": events})
    except Exception as exc:
        logger.error(f"Failed to fetch activity for {session_id}: {exc}")
        return jsonify({"error": "Failed to load activity"}), 500


@app.route("/api/stats")
def stats():
    """Aggregate tool-usage and conversation statistics."""
    try:
        return jsonify(get_stats())
    except Exception as exc:
        logger.error(f"Failed to fetch stats: {exc}")
        return jsonify({"error": "Failed to load stats"}), 500


@app.route("/api/stats/user")
def get_user_stats_endpoint():
    """Return accumulated usage stats for the current user."""
    # In local mode, user_id is always "local"
    user_id = "local"
    try:
        stats = get_user_stats(user_id)
        return jsonify(stats)
    except Exception as exc:
        logger.error(f"Failed to fetch user stats: {exc}")
        return jsonify({"error": "Failed to load user stats"}), 500


@app.route("/api/insights")
def insights_endpoint():
    """Return daily usage insights and analytics.

    Query params:
        days: Number of days to include (default 30)
        project: Optional project path filter
    """
    try:
        days_param = request.args.get("days", "30")
        try:
            days = int(days_param)
            if days < 1 or days > 365:
                days = 30
        except ValueError:
            days = 30

        project = request.args.get("project") or None

        insights = get_insights(days=days, project_path=project)
        return jsonify(insights)
    except Exception as exc:
        logger.error(f"Failed to fetch insights: {exc}")
        return jsonify({"error": "Failed to load insights"}), 500


@app.route("/api/projects")
def list_projects():
    """List available project directories in the workspace."""
    try:
        workspace = Path(WORKSPACE_PATH)
        projects = []
        for child in sorted(workspace.iterdir()):
            if child.is_dir() and not child.name.startswith('.'):
                projects.append({
                    "name": child.name,
                    "path": str(child),
                })
        return jsonify({"projects": projects, "workspace": WORKSPACE_PATH})
    except Exception as exc:
        logger.error(f"Failed to list projects: {exc}")
        return jsonify({"error": "Failed to list projects"}), 500


@app.route("/api/projects/clone", methods=["POST"])
def clone_project():
    """Clone a GitHub repository into the workspace.

    Request body:
        url: GitHub URL (https or ssh format)

    Returns:
        name: repository name
        path: absolute path to cloned directory
    """
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify({"error": "Missing 'url' in request body"}), 400

    repo_url = data["url"].strip()
    if not repo_url:
        return jsonify({"error": "Empty repository URL"}), 400

    # Validate URL format (basic check for GitHub URLs)
    import re
    github_pattern = r'^(https?://github\.com/|git@github\.com:)[\w\-]+/[\w\-]+(?:\.git)?$'
    if not re.match(github_pattern, repo_url):
        return jsonify({"error": "Invalid GitHub URL format. Expected: https://github.com/user/repo or git@github.com:user/repo"}), 400

    # Extract repo name from URL
    repo_name = repo_url.rstrip('/').rstrip('.git').split('/')[-1]

    workspace = Path(WORKSPACE_PATH).resolve()
    target_path = workspace / repo_name

    # Check if directory already exists
    if target_path.exists():
        return jsonify({"error": f"Directory '{repo_name}' already exists in workspace"}), 409

    try:
        # Clone the repository
        logger.info(f"Cloning {repo_url} to {target_path}")
        result = subprocess.run(
            ["git", "clone", repo_url, str(target_path)],
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout for large repos
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() or result.stdout.strip() or "Git clone failed"
            logger.error(f"Git clone failed: {error_msg}")
            return jsonify({"error": f"Failed to clone repository: {error_msg}"}), 500

        logger.info(f"Successfully cloned {repo_url} to {target_path}")
        return jsonify({
            "name": repo_name,
            "path": str(target_path),
        })

    except subprocess.TimeoutExpired:
        logger.error(f"Git clone timed out for {repo_url}")
        return jsonify({"error": "Clone operation timed out (>5 minutes)"}), 504
    except Exception as exc:
        logger.error(f"Failed to clone repository: {exc}")
        return jsonify({"error": f"Failed to clone repository: {str(exc)}"}), 500


@app.route("/api/git/context")
def git_context():
    """Get git context for a project directory.

    Query params:
        project: absolute path to the project directory

    Returns:
        branch: current branch name
        dirty_count: number of modified/untracked files
        commits: list of last 5 commits with hash, message, time_ago
    """
    project_path = request.args.get("project", "").strip()
    if not project_path:
        return jsonify({"error": "project parameter required"}), 400

    # Resolve to an absolute, canonical path to prevent directory traversal
    # (e.g. /workspace/../../../etc/passwd)
    try:
        project_dir = Path(project_path).resolve()
    except Exception:
        return jsonify({"error": "Invalid project path"}), 400

    # Confine to the configured workspace directory
    workspace_dir = Path(WORKSPACE_PATH).resolve()
    try:
        project_dir.relative_to(workspace_dir)
    except ValueError:
        return jsonify({"error": "Project path is outside the configured workspace"}), 403

    if not project_dir.exists():
        return jsonify({"error": f"Project path does not exist: {project_path}"}), 400

    if not project_dir.is_dir():
        return jsonify({"error": f"Project path is not a directory: {project_path}"}), 400

    # Check if it's a git repo
    try:
        subprocess.run(
            ["git", "-C", str(project_dir), "rev-parse", "--git-dir"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
    except subprocess.CalledProcessError:
        return jsonify({"error": f"Not a git repository: {project_path}"}), 400
    except Exception as exc:
        logger.error(f"Failed to check git repo: {exc}")
        return jsonify({"error": f"Failed to check git repository: {exc}"}), 500

    response = {}

    # Get current branch
    try:
        result = subprocess.run(
            ["git", "-C", str(project_dir), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            response["branch"] = result.stdout.strip()
        else:
            response["branch"] = None
    except Exception as exc:
        logger.error(f"Failed to get branch: {exc}")
        response["branch"] = None

    # Get dirty count
    try:
        result = subprocess.run(
            ["git", "-C", str(project_dir), "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            lines = [line for line in result.stdout.strip().split("\n") if line]
            response["dirty_count"] = len(lines)
        else:
            response["dirty_count"] = 0
    except Exception as exc:
        logger.error(f"Failed to get dirty count: {exc}")
        response["dirty_count"] = 0

    # Get last 5 commits
    try:
        result = subprocess.run(
            ["git", "-C", str(project_dir), "log", "--format=%H|||%h|||%s|||%ar", "-n", "5"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            commits = []
            for line in result.stdout.strip().split("\n"):
                parts = line.split("|||")
                if len(parts) == 4:
                    _, short_hash, subject, time_ago = parts
                    # Truncate subject to 60 chars
                    if len(subject) > 60:
                        subject = subject[:57] + "..."
                    commits.append({
                        "hash": short_hash,
                        "message": subject,
                        "time_ago": time_ago,
                    })
            response["commits"] = commits
        else:
            response["commits"] = []
    except Exception as exc:
        logger.error(f"Failed to get commits: {exc}")
        response["commits"] = []

    return jsonify(response)


@app.route("/api/sessions")
def list_sessions():
    """List available chat sessions with their last message preview."""
    try:
        project = request.args.get("project") or None
        sessions = get_sessions_list(project_path=project)
        return jsonify({"sessions": sessions})
    except Exception as exc:
        logger.error(f"Failed to list sessions: {exc}")
        return jsonify({"error": "Failed to list sessions"}), 500


@app.route("/api/sessions/<session_id>/archive", methods=["POST"])
def archive_session_endpoint(session_id):
    """Archive a chat session."""
    try:
        success = archive_session(session_id)
        if success:
            return jsonify({"status": "archived"})
        else:
            return jsonify({"error": "Failed to archive session"}), 500
    except Exception as exc:
        logger.error(f"Failed to archive session {session_id}: {exc}")
        return jsonify({"error": "Failed to archive session"}), 500


@app.route("/api/project/overview")
def project_overview():
    """Return project overview data for the dashboard.

    Query params:
        project: absolute path to the project directory

    Returns:
        name: project name
        path: project path
        git: {branch, dirty_count}
        file_tree: top-level directory listing
        recent_activity: last 20 tool events across all sessions for this project
        sessions: list of past sessions with their first message and stats
        stats: aggregated project stats
    """
    project_path = request.args.get("project", "").strip()
    if not project_path:
        return jsonify({"error": "project parameter required"}), 400

    # Resolve and validate path (same as git_context)
    try:
        project_dir = Path(project_path).resolve()
    except Exception:
        return jsonify({"error": "Invalid project path"}), 400

    workspace_dir = Path(WORKSPACE_PATH).resolve()
    try:
        project_dir.relative_to(workspace_dir)
    except ValueError:
        return jsonify({"error": "Project path is outside the configured workspace"}), 403

    if not project_dir.exists() or not project_dir.is_dir():
        return jsonify({"error": f"Project path does not exist or is not a directory: {project_path}"}), 400

    response = {
        "name": project_dir.name,
        "path": str(project_dir),
    }

    # Git context
    git_info = {}
    try:
        # Check if it's a git repo
        subprocess.run(
            ["git", "-C", str(project_dir), "rev-parse", "--git-dir"],
            capture_output=True,
            timeout=5,
            check=True,
        )

        # Get branch
        result = subprocess.run(
            ["git", "-C", str(project_dir), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            git_info["branch"] = result.stdout.strip()

        # Get dirty count
        result = subprocess.run(
            ["git", "-C", str(project_dir), "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            lines = [line for line in result.stdout.strip().split("\n") if line]
            git_info["dirty_count"] = len(lines)
        else:
            git_info["dirty_count"] = 0
    except Exception:
        git_info = None

    response["git"] = git_info

    # File tree (top-level only) - kept for backwards compat
    ignore_patterns = {".git", "node_modules", "__pycache__", "venv", ".env", "build", "dist", ".DS_Store", ".idea", ".vscode"}
    try:
        entries = []
        for item in sorted(project_dir.iterdir(), key=lambda x: (not x.is_dir(), x.name)):
            if item.name.startswith(".") or item.name in ignore_patterns:
                continue
            entries.append(item.name + ("/" if item.is_dir() else ""))
            if len(entries) >= 30:
                break
        response["file_tree"] = entries
    except Exception as exc:
        logger.error(f"Failed to read file tree: {exc}")
        response["file_tree"] = []

    # Language detection and file count
    ext_to_lang = {
        ".py": "Python", ".tsx": "TypeScript", ".ts": "TypeScript", ".jsx": "JavaScript",
        ".js": "JavaScript", ".css": "CSS", ".scss": "SCSS", ".html": "HTML",
        ".json": "JSON", ".md": "Markdown", ".sql": "SQL", ".sh": "Shell",
        ".bash": "Shell", ".yml": "YAML", ".yaml": "YAML", ".rs": "Rust",
        ".go": "Go", ".java": "Java", ".rb": "Ruby", ".swift": "Swift",
        ".kt": "Kotlin", ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++",
        ".xml": "XML", ".toml": "TOML", ".ini": "INI", ".vue": "Vue",
    }

    lang_counts = {}
    total_files = 0

    def scan_directory(path):
        nonlocal total_files
        try:
            for item in path.iterdir():
                if item.is_file():
                    ext = item.suffix.lower()
                    if ext in ext_to_lang:
                        lang = ext_to_lang[ext]
                        lang_counts[lang] = lang_counts.get(lang, 0) + 1
                        total_files += 1
                elif item.is_dir():
                    # Skip ignored directories
                    if item.name in ignore_patterns or item.name.startswith("."):
                        continue
                    scan_directory(item)
        except (PermissionError, OSError):
            pass

    try:
        scan_directory(project_dir)
        total = sum(lang_counts.values())
        languages = [
            {
                "name": lang,
                "files": count,
                "percentage": round((count / total * 100), 1) if total > 0 else 0
            }
            for lang, count in sorted(lang_counts.items(), key=lambda x: x[1], reverse=True)
        ]
        response["languages"] = languages
        response["file_count"] = total_files
    except Exception as exc:
        logger.error(f"Failed to scan languages: {exc}")
        response["languages"] = []
        response["file_count"] = 0

    # Commit count
    try:
        result = subprocess.run(
            ["git", "-C", str(project_dir), "rev-list", "--count", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            response["commit_count"] = int(result.stdout.strip())
        else:
            response["commit_count"] = 0
    except Exception:
        response["commit_count"] = 0

    # Tech stack detection
    tech_stack = []

    # Check for various config files
    package_json = project_dir / "package.json"
    if package_json.exists():
        try:
            import json as json_lib
            with open(package_json, "r") as f:
                pkg = json_lib.load(f)
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}

                if "react" in deps:
                    tech_stack.append("React")
                if "vue" in deps:
                    tech_stack.append("Vue")
                if "angular" in deps or "@angular/core" in deps:
                    tech_stack.append("Angular")
                if "next" in deps:
                    tech_stack.append("Next.js")
                if "express" in deps:
                    tech_stack.append("Express")
                if "electron" in deps:
                    tech_stack.append("Electron")
                if "typescript" in deps or (project_dir / "tsconfig.json").exists():
                    tech_stack.append("TypeScript")
                if "vite" in deps:
                    tech_stack.append("Vite")
                if "webpack" in deps:
                    tech_stack.append("Webpack")
        except Exception:
            pass

    # Python projects
    if (project_dir / "requirements.txt").exists() or (project_dir / "pyproject.toml").exists() or (project_dir / "Pipfile").exists():
        tech_stack.append("Python")

        # Check for Python frameworks
        for req_file in ["requirements.txt", "Pipfile"]:
            req_path = project_dir / req_file
            if req_path.exists():
                try:
                    content = req_path.read_text().lower()
                    if "flask" in content:
                        tech_stack.append("Flask")
                    if "django" in content:
                        tech_stack.append("Django")
                    if "fastapi" in content:
                        tech_stack.append("FastAPI")
                except Exception:
                    pass

    # Other languages
    if (project_dir / "Cargo.toml").exists():
        tech_stack.append("Rust")
    if (project_dir / "go.mod").exists():
        tech_stack.append("Go")
    if (project_dir / "Gemfile").exists():
        tech_stack.append("Ruby")
    if (project_dir / "pom.xml").exists() or (project_dir / "build.gradle").exists():
        tech_stack.append("Java")

    # Docker
    if (project_dir / "Dockerfile").exists():
        tech_stack.append("Docker")

    # GitHub Actions
    if (project_dir / ".github" / "workflows").exists():
        tech_stack.append("GitHub Actions")

    response["tech_stack"] = tech_stack

    # CLAUDE.md info
    claude_md_path = project_dir / "CLAUDE.md"
    if claude_md_path.exists():
        try:
            content = claude_md_path.read_text(encoding="utf-8")
            # Strip frontmatter if present
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    content = parts[2].strip()
            # Get first ~200 chars
            excerpt = content[:200].strip()
            if len(content) > 200:
                excerpt = excerpt.rsplit(" ", 1)[0] + "..."
            response["claude_md"] = {
                "exists": True,
                "excerpt": excerpt
            }
        except Exception:
            response["claude_md"] = {"exists": True, "excerpt": None}
    else:
        response["claude_md"] = {"exists": False, "excerpt": None}

    # Recent activity (last 20 tool events for this project)
    try:
        from backend.database import _get_connection
        conn = _get_connection()
        cursor = conn.cursor()

        # Get all session IDs for this project
        cursor.execute("""
            SELECT DISTINCT session_id
            FROM conversations
            WHERE project_path = ?
        """, (str(project_dir),))
        session_ids = [row[0] for row in cursor.fetchall()]

        if session_ids:
            placeholders = ",".join("?" * len(session_ids))
            cursor.execute(f"""
                SELECT tool_name, timestamp, success, session_id
                FROM tool_usage
                WHERE session_id IN ({placeholders})
                ORDER BY timestamp DESC
                LIMIT 20
            """, session_ids)

            recent_activity = []
            for row in cursor.fetchall():
                recent_activity.append({
                    "tool_name": row[0],
                    "timestamp": row[1],
                    "success": bool(row[2]) if row[2] is not None else True,
                    "session_id": row[3],
                })
            response["recent_activity"] = recent_activity
        else:
            response["recent_activity"] = []
    except Exception as exc:
        logger.error(f"Failed to fetch recent activity: {exc}")
        response["recent_activity"] = []

    # Sessions (list of past sessions for this project)
    try:
        sessions_list = get_sessions_list(project_path=str(project_dir))
        response["sessions"] = sessions_list[:20]  # Limit to 20 most recent
    except Exception as exc:
        logger.error(f"Failed to fetch sessions: {exc}")
        response["sessions"] = []

    # Stats (aggregated for this project)
    try:
        from backend.database import _get_connection
        conn = _get_connection()
        cursor = conn.cursor()

        # Get all session IDs for this project
        cursor.execute("""
            SELECT DISTINCT session_id
            FROM conversations
            WHERE project_path = ?
        """, (str(project_dir),))
        session_ids = [row[0] for row in cursor.fetchall()]

        stats = {
            "total_sessions": len(session_ids),
            "total_cost": 0.0,
            "total_duration_ms": 0.0,
            "total_tools": 0,
            "lines_of_code": 0,
        }

        if session_ids:
            placeholders = ",".join("?" * len(session_ids))

            # Aggregate tool usage
            cursor.execute(f"""
                SELECT
                    COUNT(*) as total_tools,
                    SUM(COALESCE(duration_ms, 0)) as total_duration
                FROM tool_usage
                WHERE session_id IN ({placeholders})
            """, session_ids)
            row = cursor.fetchone()
            if row:
                stats["total_tools"] = row[0] or 0
                stats["total_duration_ms"] = row[1] or 0.0

            # Count lines of code (from Write/Edit tools)
            cursor.execute(f"""
                SELECT parameters
                FROM tool_usage
                WHERE session_id IN ({placeholders})
                AND tool_name IN ('Write', 'Edit')
                AND success = 1
            """, session_ids)
            for row in cursor.fetchall():
                try:
                    params = json.loads(row[0]) if row[0] else {}
                    content = params.get("content", "") or params.get("new_string", "")
                    if content:
                        stats["lines_of_code"] += content.count("\n") + 1
                except Exception:
                    pass

        response["stats"] = stats
    except Exception as exc:
        logger.error(f"Failed to fetch project stats: {exc}")
        response["stats"] = {
            "total_sessions": 0,
            "total_cost": 0.0,
            "total_duration_ms": 0.0,
            "total_tools": 0,
            "lines_of_code": 0,
        }

    return jsonify(response)


@app.route("/api/workspace")
def get_workspace():
    """Return persisted workspace state for the current user."""
    user_id = "local"
    state = get_workspace_state(user_id)
    if state is None:
        return jsonify({"projects": [], "activeProjectPath": None})
    return jsonify(state)


@app.route("/api/workspace", methods=["PUT", "POST"])
def save_workspace():
    """Persist workspace state for the current user.

    Accepts both PUT (normal saves) and POST (sendBeacon during page unload).
    """
    user_id = "local"
    state = request.get_json()
    if not state:
        return jsonify({"error": "No state provided"}), 400
    save_workspace_state(user_id, state)
    return jsonify({"status": "ok"})


# -- Images ---------------------------------------------------------------


@app.route("/api/images/upload", methods=["POST"])
def upload_image():
    """Upload an image file.

    Accepts multipart/form-data with:
        - file: the image file
        - session_id: the browser session ID

    Returns image metadata with URL.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file or file.filename == "":
        return jsonify({"error": "Empty file"}), 400

    session_id = request.form.get("session_id", "")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    # Validate file type
    allowed_types = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
    mime_type = file.content_type
    if mime_type not in allowed_types:
        return jsonify({"error": f"Unsupported image type: {mime_type}"}), 400

    # Validate file size (10MB max)
    file.seek(0, 2)  # Seek to end
    size = file.tell()
    file.seek(0)  # Reset to beginning

    if size > 10 * 1024 * 1024:
        return jsonify({"error": "File too large (max 10MB)"}), 400

    # Generate unique ID
    image_id = str(uuid.uuid4())

    # Read file data
    data = file.read()

    try:
        image_meta = store_image(
            image_id=image_id,
            filename=file.filename,
            mime_type=mime_type,
            size=size,
            data=data,
            session_id=session_id,
        )
        return jsonify(image_meta)
    except Exception as exc:
        logger.error(f"Failed to store image: {exc}")
        return jsonify({"error": "Failed to store image"}), 500


@app.route("/api/images/<image_id>")
def get_image_endpoint(image_id):
    """Retrieve an image by ID."""
    try:
        image = get_image(image_id)
        if not image:
            return jsonify({"error": "Image not found"}), 404

        return Response(
            image["data"],
            mimetype=image["mime_type"],
            headers={"Content-Disposition": f'inline; filename="{image["filename"]}"'},
        )
    except Exception as exc:
        logger.error(f"Failed to retrieve image {image_id}: {exc}")
        return jsonify({"error": "Failed to retrieve image"}), 500


# -- Plugins --------------------------------------------------------------


@app.route("/api/plugins")
def get_plugins():
    """List all installed plugins."""
    try:
        result = plugin_manager.list_installed()
        if not result.get("success"):
            return jsonify({"error": result.get("error", "Failed to list plugins")}), 500
        return jsonify({"plugins": result.get("data", [])})
    except Exception as exc:
        logger.error(f"Failed to list plugins: {exc}")
        return jsonify({"error": "Failed to list plugins"}), 500


@app.route("/api/plugins/marketplace")
def get_marketplace_plugins():
    """List all available plugins from marketplaces."""
    try:
        search = request.args.get("search")
        result = plugin_manager.list_marketplace_plugins(search)
        if not result.get("success"):
            return jsonify({"error": result.get("error", "Failed to load marketplace")}), 500
        return jsonify({"plugins": result.get("data", [])})
    except Exception as exc:
        logger.error(f"Failed to load marketplace: {exc}")
        return jsonify({"error": "Failed to load marketplace"}), 500


@app.route("/api/plugins/install", methods=["POST"])
def install_plugin():
    """Install a plugin from a marketplace."""
    try:
        body = request.get_json(silent=True) or {}
        identifier = body.get("identifier", "").strip()

        if not identifier:
            return jsonify({"error": "Plugin identifier required"}), 400

        result = plugin_manager.install_plugin(identifier)
        if not result.get("success"):
            return jsonify({"error": result.get("error", "Installation failed")}), 500

        return jsonify(result)
    except Exception as exc:
        logger.error(f"Failed to install plugin: {exc}")
        return jsonify({"error": "Failed to install plugin"}), 500


@app.route("/api/plugins/<plugin_name>", methods=["DELETE"])
def uninstall_plugin(plugin_name):
    """Uninstall an installed plugin."""
    try:
        result = plugin_manager.uninstall_plugin(plugin_name)
        if not result.get("success"):
            return jsonify({"error": result.get("error", "Uninstallation failed")}), 500

        return jsonify(result)
    except Exception as exc:
        logger.error(f"Failed to uninstall plugin: {exc}")
        return jsonify({"error": "Failed to uninstall plugin"}), 500


@app.route("/api/plugins/<plugin_name>/skills")
def get_plugin_skills(plugin_name):
    """Get all skills provided by a specific plugin."""
    try:
        result = plugin_manager.get_plugin_skills(plugin_name)
        if not result.get("success"):
            return jsonify({"error": result.get("error", "Failed to get skills")}), 404

        return jsonify({"skills": result.get("skills", [])})
    except Exception as exc:
        logger.error(f"Failed to get plugin skills: {exc}")
        return jsonify({"error": "Failed to get plugin skills"}), 500


@app.route("/api/skills")
def get_all_skills():
    """Get all skills from all installed plugins."""
    try:
        result = plugin_manager.get_all_skills()
        if not result.get("success"):
            return jsonify({"error": result.get("error", "Failed to get skills")}), 500

        return jsonify({"skills": result.get("skills", [])})
    except Exception as exc:
        logger.error(f"Failed to get skills: {exc}")
        return jsonify({"error": "Failed to get skills"}), 500


@app.route("/api/skills/execute", methods=["POST"])
def execute_skill():
    """Execute a skill with optional arguments.

    DEPRECATED: This endpoint is deprecated. Slash commands should be sent
    directly to the Claude Code SDK via the WebSocket message handler.
    The SDK handles skill execution natively in context.

    This endpoint is kept for backward compatibility but returns an error.
    """
    return jsonify({
        "error": "Direct skill execution is deprecated. Use slash commands in chat (e.g., /polish) instead.",
        "deprecated": True,
    }), 410  # 410 Gone - resource no longer available


# =========================================================================
# WebSocket Events
# =========================================================================


@socketio.on("connect")
def handle_connect(auth=None):
    """Authenticate the WebSocket handshake and join the session room.

    Expects ``token`` and ``session_id`` as query parameters on the
    connection URL. If the token is missing or invalid, the connection
    is refused.

    Args:
        auth: Optional authentication data (unused, kept for Flask-SocketIO 5.x compatibility)
    """
    token = request.args.get("token", "")
    user_id = verify_token(token)

    if not user_id:
        logger.warning("WebSocket connection rejected: invalid token")
        disconnect()
        return

    session_id = request.args.get("session_id", request.sid)

    connected_clients[request.sid] = {
        "session_id": session_id,
        "user_id": user_id,
    }
    join_room(session_id)

    # Check if this session has an active query in the worker
    if session_manager.is_active(session_id):
        # Re-register streaming callbacks for this session
        # (handles the case where Flask restarted while worker was mid-query)
        def on_text_reconnect(text: str) -> None:
            socketio.emit("text_delta", {"text": text}, room=session_id)

        def on_tool_event_reconnect(event: dict) -> None:
            socketio.emit("tool_event", event, room=session_id)
            # Count lines of code from Write and Edit tools
            if event.get("type") == "tool_complete" and event.get("tool_name") in ("Write", "Edit"):
                params = event.get("parameters", {})
                content = ""
                if isinstance(params, dict):
                    content = params.get("content", "") or params.get("new_string", "")
                if content:
                    lines = content.count("\n") + 1
                    try:
                        increment_user_stats(user_id="local", lines_of_code=lines)
                    except Exception as e:
                        logger.error(f"Failed to increment LOC: {e}")

        def on_complete_reconnect(result: dict) -> None:
            try:
                increment_user_stats(
                    user_id="local",
                    queries=1,
                    duration_ms=result.get("duration_ms") or 0,
                    cost=result.get("cost") or 0,
                    input_tokens=result.get("input_tokens") or 0,
                    output_tokens=result.get("output_tokens") or 0,
                )
            except Exception as e:
                logger.error(f"Failed to increment user stats: {e}")

            socketio.emit(
                "response_complete",
                {
                    "cost": result.get("cost"),
                    "duration_ms": result.get("duration_ms"),
                    "input_tokens": result.get("input_tokens"),
                    "output_tokens": result.get("output_tokens"),
                    "model": result.get("model"),
                    "sdk_session_id": result.get("sdk_session_id"),
                    "content": result.get("text"),
                },
                room=session_id,
            )

        def on_error_reconnect(error_msg: str) -> None:
            socketio.emit("error", {"message": error_msg}, room=session_id)

        def on_user_question_reconnect(data: dict) -> None:
            socketio.emit("user_question", {
                "questions": data.get("questions", []),
                "tool_use_id": data.get("tool_use_id", ""),
            }, room=session_id)

        session_manager.register_streaming_callbacks(
            session_id,
            on_text=on_text_reconnect,
            on_tool_event=on_tool_event_reconnect,
            on_complete=on_complete_reconnect,
            on_error=on_error_reconnect,
            on_user_question=on_user_question_reconnect,
        )
        logger.info(f"Re-registered callbacks for active session {session_id}")
        socketio.emit("stream_active", {}, room=session_id)

        # Re-emit pending question if worker has one waiting
        pq = session_manager.get_pending_question(session_id)
        if pq:
            socketio.emit("user_question", {
                "questions": pq.get("questions", []),
                "tool_use_id": pq.get("tool_use_id", ""),
            }, room=session_id)
            logger.info(f"Re-emitted pending question for session {session_id}")

    logger.info(f"Client connected: user={user_id} session={session_id}")
    emit("connected", {"session_id": session_id})


@socketio.on("disconnect")
def handle_disconnect():
    """Clean up client tracking on disconnect.

    Does NOT disconnect the SDK session -- the worker keeps it alive
    so queries complete even when the user switches sessions or
    refreshes the browser. Callbacks remain registered so DB writes
    continue and SocketIO emits to the dead room are harmlessly dropped.
    """
    client = connected_clients.pop(request.sid, None)
    if client:
        logger.info(
            f"Client disconnected: user={client['user_id']} "
            f"session={client['session_id']}"
        )


@socketio.on("message")
def handle_message(data):
    """Receive a user message and stream the SDK response.

    Flow:
        1. Validate the client is authenticated.
        2. Record the user message to the database.
        3. Emit ``message_received`` acknowledgment.
        4. Submit the prompt to :class:`SessionManager` with streaming
           callbacks that emit SocketIO events back to the client's room.

    Slash commands (e.g., /polish, /critique) are passed directly to the
    Claude Code SDK, which handles skill execution natively in context.

    Emitted events:
        - ``message_received`` -- immediate ack
        - ``text_delta``       -- partial text chunks as they arrive
        - ``tool_event``       -- tool start/complete events for the activity tree
        - ``response_complete`` -- final message with cost/token metadata
        - ``error``            -- if the SDK query fails
    """
    client = connected_clients.get(request.sid)
    if not client:
        emit("error", {"message": "Not authenticated"})
        return

    session_id = client["session_id"]
    user_id = client["user_id"]
    content = (data.get("content", "") if isinstance(data, dict) else "").strip()
    workspace = (data.get("workspace", "") if isinstance(data, dict) else "") or WORKSPACE_PATH
    model = (data.get("model", "") if isinstance(data, dict) else "") or None
    image_ids = (data.get("image_ids", []) if isinstance(data, dict) else [])
    # Only record actual selected project in project_path, not the default workspace
    project_path = data.get("workspace", "") if isinstance(data, dict) else ""

    if not content and not image_ids:
        return

    # Persist user message
    try:
        record_message(
            session_id,
            user_id,
            "user",
            content or "[Image]",
            project_path=project_path or None,
            image_ids=image_ids if image_ids else None,
        )
        # Increment session count if this is the first message in a new session
        existing = get_conversation_history(session_id, limit=1)
        # If history only has the message we just recorded, it's a new session
        if len(existing) <= 1:
            try:
                increment_user_stats(user_id=user_id, sessions=1)
            except Exception as e:
                logger.error(f"Failed to increment session count: {e}")
    except Exception as exc:
        logger.error(f"Failed to record user message: {exc}")

    emit("message_received", {"status": "ok"})

    # -- Streaming callbacks (all emit to the session room) ----------------

    def on_text(text: str) -> None:
        socketio.emit("text_delta", {"text": text}, room=session_id)

    def on_tool_event(event: dict) -> None:
        socketio.emit("tool_event", event, room=session_id)
        # Count lines of code from Write and Edit tools
        if event.get("type") == "tool_complete" and event.get("tool_name") in ("Write", "Edit"):
            params = event.get("parameters", {})
            content = ""
            if isinstance(params, dict):
                content = params.get("content", "") or params.get("new_string", "")
            if content:
                lines = content.count("\n") + 1
                try:
                    increment_user_stats(user_id=user_id, lines_of_code=lines)
                except Exception as e:
                    logger.error(f"Failed to increment LOC: {e}")

    def on_complete(result: dict) -> None:
        try:
            increment_user_stats(
                user_id=user_id,
                queries=1,
                duration_ms=result.get("duration_ms") or 0,
                cost=result.get("cost") or 0,
                input_tokens=result.get("input_tokens") or 0,
                output_tokens=result.get("output_tokens") or 0,
            )
        except Exception as e:
            logger.error(f"Failed to increment user stats: {e}")

        socketio.emit(
            "response_complete",
            {
                "cost": result.get("cost"),
                "duration_ms": result.get("duration_ms"),
                "input_tokens": result.get("input_tokens"),
                "output_tokens": result.get("output_tokens"),
                "model": result.get("model"),
                "sdk_session_id": result.get("sdk_session_id"),
                "content": result.get("text"),
            },
            room=session_id,
        )

    def on_error(error_msg: str) -> None:
        socketio.emit("error", {"message": error_msg}, room=session_id)

    def on_user_question(data: dict) -> None:
        socketio.emit("user_question", {
            "questions": data.get("questions", []),
            "tool_use_id": data.get("tool_use_id", ""),
        }, room=session_id)

    # Submit to SDK (runs async in SessionManager's background loop)
    # Slash commands (e.g., /polish, /critique) are sent directly to the SDK
    # which handles skill execution natively in context
    session_manager.submit_query(
        session_id=session_id,
        prompt=content or "[Image attached]",
        workspace=workspace,
        model=model,
        image_ids=image_ids if image_ids else None,
        on_text=on_text,
        on_tool_event=on_tool_event,
        on_complete=on_complete,
        on_error=on_error,
        on_user_question=on_user_question,
    )


@socketio.on("cancel")
def handle_cancel():
    """Cancel the active SDK query for the caller's session."""
    client = connected_clients.get(request.sid)
    if not client:
        return

    session_manager.cancel_query(client["session_id"])
    emit("cancelled", {"status": "ok"})
    logger.info(f"Query cancelled by user: session={client['session_id']}")


@socketio.on("ping")
def handle_ping():
    """Keepalive ping -- respond with server timestamp."""
    emit("pong", {"timestamp": time.time()})


@socketio.on("question_response")
def handle_question_response(data):
    """Forward user's question response to the SDK worker."""
    client = connected_clients.get(request.sid)
    if not client:
        return

    session_id = client["session_id"]
    response = data.get("response", {}) if isinstance(data, dict) else {}
    session_manager.send_question_response(session_id, response)
    logger.info(f"Question response forwarded for session={session_id}")


# =========================================================================
# Entrypoint
# =========================================================================

if __name__ == "__main__":
    logger.info(f"Starting ccplus server on port {PORT}")
    logger.info(f"Local mode: {LOCAL_MODE}")
    logger.info(f"Workspace: {WORKSPACE_PATH}")
    logger.info(f"Database: {DATABASE_PATH}")
    logger.info(f"Static dir: {STATIC_DIR}")

    socketio.run(
        app,
        host=HOST,
        port=PORT,
        debug=False,
        allow_unsafe_werkzeug=True,
    )
