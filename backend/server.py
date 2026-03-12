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
    get_conversation_history,
    get_stats,
    record_message,
    record_tool_event,
)
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


@app.route("/api/stats")
def stats():
    """Aggregate tool-usage and conversation statistics."""
    try:
        return jsonify(get_stats())
    except Exception as exc:
        logger.error(f"Failed to fetch stats: {exc}")
        return jsonify({"error": "Failed to load stats"}), 500


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

    logger.info(f"Client connected: user={user_id} session={session_id}")
    emit("connected", {"session_id": session_id})


@socketio.on("disconnect")
def handle_disconnect():
    """Clean up client tracking on disconnect.

    Disconnects the persistent SDK client to free resources.
    """
    client = connected_clients.pop(request.sid, None)
    if client:
        session_id = client['session_id']
        logger.info(
            f"Client disconnected: user={client['user_id']} "
            f"session={session_id}"
        )
        # Disconnect persistent subprocess
        session_manager.disconnect_session(session_id)


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

    if not content:
        return

    # Persist user message
    try:
        record_message(session_id, user_id, "user", content)
    except Exception as exc:
        logger.error(f"Failed to record user message: {exc}")

    emit("message_received", {"status": "ok"})

    # -- Streaming callbacks (all emit to the session room) ----------------

    def on_text(text: str) -> None:
        socketio.emit("text_delta", {"text": text}, room=session_id)

    def on_tool_event(event: dict) -> None:
        socketio.emit("tool_event", event, room=session_id)

        # Persist tool event to database
        try:
            record_tool_event(
                session_id=session_id,
                tool_name=event.get("tool_name", "unknown"),
                tool_use_id=event.get("tool_use_id", ""),
                parent_agent_id=event.get("parent_agent_id"),
                agent_type=event.get("agent_type"),
                success=event.get("success"),
                error=event.get("error"),
                duration_ms=event.get("duration_ms"),
                parameters=event.get("parameters"),
            )
        except Exception as exc:
            logger.error(f"Failed to record tool event: {exc}")

    def on_complete(result: dict) -> None:
        full_text = result.get("text", "")
        if full_text:
            try:
                record_message(
                    session_id,
                    "assistant",
                    "assistant",
                    full_text,
                    sdk_session_id=result.get("session_id"),
                )
            except Exception as exc:
                logger.error(f"Failed to record assistant message: {exc}")

        socketio.emit(
            "response_complete",
            {
                "cost": result.get("cost"),
                "duration_ms": result.get("duration_ms"),
                "input_tokens": result.get("input_tokens"),
                "output_tokens": result.get("output_tokens"),
            },
            room=session_id,
        )

    def on_error(error_msg: str) -> None:
        socketio.emit("error", {"message": error_msg}, room=session_id)

    # Submit to SDK (runs async in SessionManager's background loop)
    session_manager.submit_query(
        session_id=session_id,
        prompt=content,
        workspace=WORKSPACE_PATH,
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
