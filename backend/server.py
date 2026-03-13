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

import logging
import os
import sys
import time
from pathlib import Path

# Remove CLAUDECODE env var to allow SDK subprocess spawning
# (otherwise Claude Code detects "nested session" and refuses to start)
os.environ.pop("CLAUDECODE", None)

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, disconnect, emit, join_room

# Add parent to path so ``backend.*`` imports resolve when running directly
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.auth import auto_login, verify_token
from backend.config import (
    DATABASE_PATH,
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
    get_sessions_list,
    get_stats,
    get_tool_events,
    record_message,
)
from backend.plugins import PluginManager
from backend.sdk_session import SessionManager
from backend.skills import SkillExecutor

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

CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"])

socketio = SocketIO(
    app,
    async_mode="threading",
    cors_allowed_origins="*",
    ping_timeout=60,
    ping_interval=25,
)

session_manager = SessionManager()
plugin_manager = PluginManager()
skill_executor = SkillExecutor()

START_TIME = time.time()

# Maps SocketIO request.sid -> {session_id, user_id}
connected_clients: dict[str, dict] = {}


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


# -- Data -----------------------------------------------------------------


@app.route("/api/history/<session_id>")
def get_history(session_id):
    """Return conversation history for a session.

    TODO: verify the session belongs to the authenticated user.
    """
    try:
        messages = get_conversation_history(session_id)
        return jsonify({"messages": messages})
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
    """Execute a skill with optional arguments."""
    try:
        body = request.get_json(silent=True) or {}
        skill_name = body.get("skill", "").strip()
        arguments = body.get("arguments", "").strip()
        workspace = body.get("workspace", "")

        if not skill_name:
            return jsonify({"error": "Skill name required"}), 400

        result = skill_executor.execute_skill(
            skill_name=skill_name,
            arguments=arguments,
            workspace=workspace or None,
        )

        if not result.get("success"):
            return jsonify(result), 500

        return jsonify(result)
    except Exception as exc:
        logger.error(f"Failed to execute skill: {exc}")
        return jsonify({"error": "Failed to execute skill"}), 500


# =========================================================================
# WebSocket Events
# =========================================================================


@socketio.on("connect")
def handle_connect():
    """Authenticate the WebSocket handshake and join the session room.

    Expects ``token`` and ``session_id`` as query parameters on the
    connection URL. If the token is missing or invalid, the connection
    is refused.
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

        def on_complete_reconnect(result: dict) -> None:
            socketio.emit(
                "response_complete",
                {
                    "cost": result.get("cost"),
                    "duration_ms": result.get("duration_ms"),
                    "input_tokens": result.get("input_tokens"),
                    "output_tokens": result.get("output_tokens"),
                    "model": result.get("model"),
                },
                room=session_id,
            )

        def on_error_reconnect(error_msg: str) -> None:
            socketio.emit("error", {"message": error_msg}, room=session_id)

        session_manager.register_streaming_callbacks(
            session_id,
            on_text=on_text_reconnect,
            on_tool_event=on_tool_event_reconnect,
            on_complete=on_complete_reconnect,
            on_error=on_error_reconnect,
        )
        logger.info(f"Re-registered callbacks for active session {session_id}")

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
    # Only record actual selected project in project_path, not the default workspace
    project_path = data.get("workspace", "") if isinstance(data, dict) else ""

    if not content:
        return

    # Persist user message
    try:
        record_message(session_id, user_id, "user", content, project_path=project_path or None)
    except Exception as exc:
        logger.error(f"Failed to record user message: {exc}")

    emit("message_received", {"status": "ok"})

    # Check if this is a slash command
    if content.startswith("/"):
        parts = content[1:].split(None, 1)  # Split on first whitespace
        command = parts[0].lower()
        arguments = parts[1] if len(parts) > 1 else ""

        # Handle built-in commands
        if command == "help":
            help_text = """**Available Commands:**

- `/help` - Show this help message
- `/skills` - List all available skills
- `/[skill-name]` - Execute a skill (e.g., `/polish`, `/distill`)
- `/[skill-name] [args]` - Execute a skill with arguments

**Available Skills:**
Use `/skills` to see all installed skills from your plugins.
"""
            socketio.emit("text_delta", {"text": help_text}, room=session_id)
            socketio.emit("response_complete", {"cost": 0, "duration_ms": 0}, room=session_id)
            try:
                record_message(session_id, user_id, "assistant", help_text, project_path=project_path or None)
            except Exception as exc:
                logger.error(f"Failed to record help response: {exc}")
            return

        elif command == "skills":
            # List all available skills
            result = plugin_manager.get_all_skills()
            if result.get("success"):
                skills = result.get("skills", [])
                if skills:
                    skills_text = "**Available Skills:**\n\n"
                    for skill in skills:
                        skills_text += f"- `/{skill['name']}` — {skill.get('plugin', 'unknown plugin')}\n"
                else:
                    skills_text = "No skills installed. Install plugins from the marketplace to get skills."
            else:
                skills_text = f"Error loading skills: {result.get('error', 'Unknown error')}"

            socketio.emit("text_delta", {"text": skills_text}, room=session_id)
            socketio.emit("response_complete", {"cost": 0, "duration_ms": 0}, room=session_id)
            try:
                record_message(session_id, user_id, "assistant", skills_text, project_path=project_path or None)
            except Exception as exc:
                logger.error(f"Failed to record skills response: {exc}")
            return

        else:
            # Try to execute as a skill
            skill_name = command
            logger.info(f"Attempting to execute skill: {skill_name} with args: {arguments}")

            # Emit skill execution start
            socketio.emit("text_delta", {"text": f"Executing skill `{skill_name}`...\n\n"}, room=session_id)

            result = skill_executor.execute_skill(
                skill_name=skill_name,
                arguments=arguments,
                workspace=workspace,
            )

            if result.get("success"):
                output = result.get("output", "")
                response_text = f"**Skill Output:**\n\n```\n{output}\n```"
            else:
                error = result.get("error", "Unknown error")
                response_text = f"**Error executing skill `{skill_name}`:**\n\n{error}"

            socketio.emit("text_delta", {"text": response_text}, room=session_id)
            socketio.emit("response_complete", {"cost": 0, "duration_ms": 0}, room=session_id)
            try:
                full_response = f"Executing skill `{skill_name}`...\n\n{response_text}"
                record_message(session_id, user_id, "assistant", full_response, project_path=project_path or None)
            except Exception as exc:
                logger.error(f"Failed to record skill response: {exc}")
            return

    # -- Streaming callbacks (all emit to the session room) ----------------

    def on_text(text: str) -> None:
        socketio.emit("text_delta", {"text": text}, room=session_id)

    def on_tool_event(event: dict) -> None:
        socketio.emit("tool_event", event, room=session_id)

    def on_complete(result: dict) -> None:
        socketio.emit(
            "response_complete",
            {
                "cost": result.get("cost"),
                "duration_ms": result.get("duration_ms"),
                "input_tokens": result.get("input_tokens"),
                "output_tokens": result.get("output_tokens"),
                "model": result.get("model"),
            },
            room=session_id,
        )

    def on_error(error_msg: str) -> None:
        socketio.emit("error", {"message": error_msg}, room=session_id)

    # Submit to SDK (runs async in SessionManager's background loop)
    session_manager.submit_query(
        session_id=session_id,
        prompt=content,
        workspace=workspace,
        model=model,
        on_text=on_text,
        on_tool_event=on_tool_event,
        on_complete=on_complete,
        on_error=on_error,
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
        host="0.0.0.0",
        port=PORT,
        debug=False,
        allow_unsafe_werkzeug=True,
    )
