import json
import sqlite3
import threading
from typing import Optional

import backend.config as config

_local = threading.local()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_login TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS revoked_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jti TEXT NOT NULL UNIQUE,
    revoked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(jti);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    sdk_session_id TEXT,
    project_path TEXT,
    archived BOOLEAN DEFAULT 0,
    images TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_session
    ON conversations(session_id, timestamp);

CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    session_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_session ON images(session_id);

CREATE TABLE IF NOT EXISTS tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    duration_ms REAL,
    success BOOLEAN,
    error TEXT,
    error_category TEXT,
    parameters TEXT,
    tool_use_id TEXT,
    parent_agent_id TEXT,
    agent_type TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_usage_session
    ON tool_usage(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_usage_parent
    ON tool_usage(parent_agent_id);

CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    total_sessions INTEGER NOT NULL DEFAULT 0,
    total_queries INTEGER NOT NULL DEFAULT 0,
    total_duration_ms REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_lines_of_code INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""


def _get_connection() -> sqlite3.Connection:
    """Return a thread-local SQLite connection, creating one if needed."""
    current_path = config.DATABASE_PATH
    conn = getattr(_local, "connection", None)
    stored_path = getattr(_local, "db_path", None)
    if conn is None or stored_path != current_path:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        conn = sqlite3.connect(current_path)
        _local.db_path = current_path
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA_SQL)
        try:
            conn.execute("ALTER TABLE conversations ADD COLUMN project_path TEXT")
            conn.commit()
        except Exception:
            pass  # Column already exists
        _local.connection = conn
        # Ensure archived column exists (migration for existing DBs)
        try:
            conn.execute("ALTER TABLE conversations ADD COLUMN archived BOOLEAN DEFAULT 0")
            conn.commit()
        except Exception:
            pass  # Column already exists
        # Ensure images column exists (migration for existing DBs)
        try:
            conn.execute("ALTER TABLE conversations ADD COLUMN images TEXT")
            conn.commit()
        except Exception:
            pass  # Column already exists
    return conn


def record_message(
    session_id: str,
    user_id: str,
    role: str,
    content: str,
    sdk_session_id: Optional[str] = None,
    project_path: Optional[str] = None,
    image_ids: Optional[list[str]] = None,
) -> dict:
    """Insert a conversation message and return it as a dict."""
    conn = _get_connection()
    images_json = json.dumps(image_ids) if image_ids else None
    cursor = conn.execute(
        """
        INSERT INTO conversations (session_id, user_id, role, content, sdk_session_id, project_path, images)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (session_id, user_id, role, content, sdk_session_id, project_path, images_json),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return dict(row)


def update_message(message_id: int, content: str, sdk_session_id: Optional[str] = None) -> None:
    """Update an existing conversation message's content."""
    conn = _get_connection()
    if sdk_session_id:
        conn.execute(
            "UPDATE conversations SET content = ?, sdk_session_id = ? WHERE id = ?",
            (content, sdk_session_id, message_id),
        )
    else:
        conn.execute(
            "UPDATE conversations SET content = ? WHERE id = ?",
            (content, message_id),
        )
    conn.commit()


def update_tool_event(
    session_id: str,
    tool_use_id: str,
    success: Optional[bool] = None,
    error: Optional[str] = None,
    duration_ms: Optional[float] = None,
) -> None:
    """Update an existing tool event (e.g., mark as completed)."""
    conn = _get_connection()
    conn.execute(
        """
        UPDATE tool_usage
        SET success = ?, error = ?, duration_ms = ?
        WHERE session_id = ? AND tool_use_id = ?
        """,
        (success, error, duration_ms, session_id, tool_use_id),
    )
    conn.commit()


def get_conversation_history(session_id: str, limit: int = 50) -> list[dict]:
    """Return conversation messages for a session, oldest first."""
    conn = _get_connection()
    rows = conn.execute(
        """
        SELECT * FROM conversations
        WHERE session_id = ?
        ORDER BY timestamp ASC
        LIMIT ?
        """,
        (session_id, limit),
    ).fetchall()
    messages = []
    for row in rows:
        msg = dict(row)
        # Parse images JSON and fetch image metadata
        if msg.get("images"):
            try:
                image_ids = json.loads(msg["images"])
                msg["images"] = get_message_images(image_ids)
            except (json.JSONDecodeError, TypeError):
                msg["images"] = []
        else:
            msg["images"] = []
        messages.append(msg)
    return messages


def record_tool_event(
    session_id: str,
    tool_name: str,
    tool_use_id: str,
    parent_agent_id: Optional[str] = None,
    agent_type: Optional[str] = None,
    success: Optional[bool] = None,
    error: Optional[str] = None,
    duration_ms: Optional[float] = None,
    parameters: Optional[dict] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
) -> dict:
    """Insert a tool usage event and return it as a dict."""
    conn = _get_connection()
    params_json = json.dumps(parameters) if parameters is not None else None
    cursor = conn.execute(
        """
        INSERT INTO tool_usage
            (session_id, tool_name, tool_use_id, parent_agent_id, agent_type,
             success, error, duration_ms, parameters, input_tokens, output_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            tool_name,
            tool_use_id,
            parent_agent_id,
            agent_type,
            success,
            error,
            duration_ms,
            params_json,
            input_tokens,
            output_tokens,
        ),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM tool_usage WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return dict(row)


def get_tool_events(session_id: str, limit: int = 200) -> list[dict]:
    """Return tool usage events for a session, oldest first."""
    conn = _get_connection()
    rows = conn.execute(
        """
        SELECT * FROM tool_usage
        WHERE session_id = ?
        ORDER BY timestamp ASC
        LIMIT ?
        """,
        (session_id, limit),
    ).fetchall()
    results = []
    for row in rows:
        entry = dict(row)
        if entry.get("parameters"):
            try:
                entry = {**entry, "parameters": json.loads(entry["parameters"])}
            except (json.JSONDecodeError, TypeError):
                pass
        results.append(entry)
    return results


def get_sessions_list(limit: int = 50, project_path: Optional[str] = None, include_archived: bool = False) -> list[dict]:
    """Return a list of sessions with metadata (last message preview, message count).

    By default, archived sessions are excluded. Set include_archived=True to include them.
    """
    conn = _get_connection()
    having_clause = "HAVING (project_path = ? OR project_path IS NULL)" if project_path else ""
    archived_clause = "" if include_archived else "AND (c1.archived = 0 OR c1.archived IS NULL)"
    params: list = [project_path, limit] if project_path else [limit]
    rows = conn.execute(
        f"""
        SELECT
            session_id,
            COUNT(*) as message_count,
            MAX(timestamp) as last_activity,
            (SELECT content FROM conversations c2
             WHERE c2.session_id = c1.session_id AND c2.role = 'user'
             ORDER BY c2.timestamp DESC LIMIT 1) as last_user_message,
            (SELECT project_path FROM conversations c3
             WHERE c3.session_id = c1.session_id AND c3.role = 'user'
             AND c3.project_path IS NOT NULL
             ORDER BY c3.timestamp DESC LIMIT 1) as project_path
        FROM conversations c1
        WHERE 1=1 {archived_clause}
        GROUP BY session_id
        {having_clause}
        ORDER BY last_activity DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    results = []
    for row in rows:
        entry = dict(row)
        if entry.get("last_user_message") and len(entry["last_user_message"]) > 80:
            entry = {**entry, "last_user_message": entry["last_user_message"][:80] + "..."}
        results.append(entry)
    return results


def get_last_sdk_session_id(session_id: str) -> Optional[str]:
    """Return the most recent SDK session ID for a browser session, if any."""
    conn = _get_connection()
    row = conn.execute(
        """
        SELECT sdk_session_id FROM conversations
        WHERE session_id = ? AND sdk_session_id IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1
        """,
        (session_id,),
    ).fetchone()
    return row["sdk_session_id"] if row else None


def archive_session(session_id: str) -> bool:
    """Mark a session as archived. Returns True if successful."""
    conn = _get_connection()
    try:
        conn.execute(
            "UPDATE conversations SET archived = 1 WHERE session_id = ?",
            (session_id,),
        )
        conn.commit()
        return True
    except Exception:
        return False


def get_stats() -> dict:
    """Return aggregate statistics across all sessions."""
    conn = _get_connection()

    total_conversations = conn.execute(
        "SELECT COUNT(*) FROM conversations"
    ).fetchone()[0]

    total_tool_events = conn.execute(
        "SELECT COUNT(*) FROM tool_usage"
    ).fetchone()[0]

    tool_rows = conn.execute(
        """
        SELECT tool_name, COUNT(*) as count
        FROM tool_usage
        GROUP BY tool_name
        ORDER BY count DESC
        """
    ).fetchall()
    events_by_tool = {row["tool_name"]: row["count"] for row in tool_rows}

    return {
        "total_conversations": total_conversations,
        "total_tool_events": total_tool_events,
        "events_by_tool": events_by_tool,
    }


def store_image(image_id: str, filename: str, mime_type: str, size: int, data: bytes, session_id: str) -> dict:
    """Store an image in the database and return its metadata."""
    conn = _get_connection()
    conn.execute(
        """
        INSERT INTO images (id, filename, mime_type, size, data, session_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (image_id, filename, mime_type, size, data, session_id),
    )
    conn.commit()
    return {
        "id": image_id,
        "filename": filename,
        "mime_type": mime_type,
        "size": size,
        "url": f"/api/images/{image_id}",
    }


def get_image(image_id: str) -> Optional[dict]:
    """Retrieve an image by ID."""
    conn = _get_connection()
    row = conn.execute(
        "SELECT * FROM images WHERE id = ?", (image_id,)
    ).fetchone()
    return dict(row) if row else None


def get_message_images(image_ids: list[str]) -> list[dict]:
    """Retrieve multiple images by their IDs."""
    if not image_ids:
        return []
    conn = _get_connection()
    placeholders = ",".join("?" * len(image_ids))
    rows = conn.execute(
        f"SELECT id, filename, mime_type, size FROM images WHERE id IN ({placeholders})",
        image_ids,
    ).fetchall()
    return [
        {
            **dict(row),
            "url": f"/api/images/{row['id']}",
        }
        for row in rows
    ]


def mark_orphaned_tool_events() -> int:
    """Mark all running tool events (success IS NULL) as failed due to worker restart.
    Returns the number of events marked."""
    conn = _get_connection()
    cursor = conn.execute(
        """
        UPDATE tool_usage
        SET success = 0, error = 'Worker restarted', duration_ms = 0
        WHERE success IS NULL
        """
    )
    conn.commit()
    return cursor.rowcount


def get_user_stats(user_id: str) -> dict:
    """Return accumulated stats for a user. Creates row if missing."""
    conn = _get_connection()
    row = conn.execute("SELECT * FROM user_stats WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        conn.execute("INSERT INTO user_stats (user_id) VALUES (?)", (user_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM user_stats WHERE user_id = ?", (user_id,)).fetchone()
    return dict(row)


def increment_user_stats(
    user_id: str,
    sessions: int = 0,
    queries: int = 0,
    duration_ms: float = 0,
    cost: float = 0,
    input_tokens: int = 0,
    output_tokens: int = 0,
    lines_of_code: int = 0,
) -> None:
    """Atomically increment user stats counters."""
    conn = _get_connection()
    conn.execute(
        """
        INSERT INTO user_stats (user_id, total_sessions, total_queries, total_duration_ms,
                                total_cost, total_input_tokens, total_output_tokens,
                                total_lines_of_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            total_sessions = total_sessions + excluded.total_sessions,
            total_queries = total_queries + excluded.total_queries,
            total_duration_ms = total_duration_ms + excluded.total_duration_ms,
            total_cost = total_cost + excluded.total_cost,
            total_input_tokens = total_input_tokens + excluded.total_input_tokens,
            total_output_tokens = total_output_tokens + excluded.total_output_tokens,
            total_lines_of_code = total_lines_of_code + excluded.total_lines_of_code,
            updated_at = datetime('now', 'localtime')
        """,
        (user_id, sessions, queries, duration_ms, cost, input_tokens, output_tokens, lines_of_code),
    )
    conn.commit()
