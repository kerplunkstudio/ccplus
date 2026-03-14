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
    get_image,
    get_sessions_list,
    get_stats,
    get_tool_events,
    record_message,
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

START_TIME = time.time()

# Maps SocketIO request.sid -> {session_id, user_id}
connected_clients: dict[str, dict] = {}


def _handle_worker_reconnect(session_id: str):
    """Auto-register SocketIO callbacks when worker reconnects with active sessions."""
    logger.info(f"Auto-registering callbacks for active session {session_id} after worker reconnect")

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

    session_manager.register_streaming_callbacks(
        session_id,
        on_text=on_text,
        on_tool_event=on_tool_event,
        on_complete=on_complete,
        on_error=on_error,
    )

    # Notify any connected browser clients that streaming is active
    socketio.emit("stream_active", {}, room=session_id)


session_manager.on_session_reconnect = _handle_worker_reconnect


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
    import uuid
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

        from flask import Response
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
        socketio.emit("stream_active", {}, room=session_id)

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
    except Exception as exc:
        logger.error(f"Failed to record user message: {exc}")

    emit("message_received", {"status": "ok"})

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
    response = data.get("response", "") if isinstance(data, dict) else ""
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
        host="0.0.0.0",
        port=PORT,
        debug=False,
        allow_unsafe_werkzeug=True,
    )
