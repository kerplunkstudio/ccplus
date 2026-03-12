import json
import sqlite3
import threading
from typing import Optional

import backend.config as config

_local = threading.local()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    sdk_session_id TEXT,
    project_path TEXT,
    archived BOOLEAN DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conversations_session
    ON conversations(session_id, timestamp);

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
    return conn


def record_message(
    session_id: str,
    user_id: str,
    role: str,
    content: str,
    sdk_session_id: Optional[str] = None,
    project_path: Optional[str] = None,
) -> dict:
    """Insert a conversation message and return it as a dict."""
    conn = _get_connection()
    cursor = conn.execute(
        """
        INSERT INTO conversations (session_id, user_id, role, content, sdk_session_id, project_path)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (session_id, user_id, role, content, sdk_session_id, project_path),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM conversations WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return dict(row)


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
    return [dict(row) for row in rows]


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
    having_clause = "HAVING project_path = ?" if project_path else ""
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
