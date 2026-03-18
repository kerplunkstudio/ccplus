# Database Schema

**Location**: `data/ccplus.db` (SQLite, WAL mode)

## Tables

### Core Tables

```sql
-- User authentication (JWT-based)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_login TEXT
);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- Revoked JWT tokens (for logout)
CREATE TABLE revoked_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jti TEXT NOT NULL UNIQUE,
    revoked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    expires_at TEXT NOT NULL
);
CREATE INDEX idx_revoked_tokens_jti ON revoked_tokens(jti);

-- Conversation messages
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,       -- Browser session ID (session_<timestamp>_<random>)
    user_id TEXT NOT NULL,          -- "local" in local mode
    role TEXT NOT NULL,             -- "user" or "assistant"
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    sdk_session_id TEXT,            -- SDK session UUID (set on assistant messages)
    project_path TEXT,              -- Workspace path for this conversation
    archived BOOLEAN DEFAULT 0,     -- Whether session is archived
    images TEXT                     -- JSON array of image IDs
);
CREATE INDEX idx_conversations_session ON conversations(session_id, timestamp);

-- Image storage (base64-encoded, stored as BLOB)
CREATE TABLE images (
    id TEXT PRIMARY KEY,            -- UUID
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,             -- Binary image data
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    session_id TEXT NOT NULL
);
CREATE INDEX idx_images_session ON images(session_id);

-- Tool usage tracking
CREATE TABLE tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,        -- "Bash", "Read", "Edit", "Agent", etc.
    duration_ms REAL,
    success BOOLEAN,
    error TEXT,
    error_category TEXT,
    parameters TEXT,                -- JSON blob (truncated to 200 chars per value)
    tool_use_id TEXT,               -- Unique ID for this tool invocation
    parent_agent_id TEXT,           -- tool_use_id of the parent Agent (null at root level)
    agent_type TEXT,                -- For Agent/Task tools: the subagent type
    input_tokens INTEGER,
    output_tokens INTEGER,
    description TEXT,               -- Agent description (for Agent tools)
    summary TEXT                    -- Agent output summary (for Agent tools)
);
CREATE INDEX idx_tool_usage_session ON tool_usage(session_id, timestamp);
CREATE INDEX idx_tool_usage_parent ON tool_usage(parent_agent_id);

-- User statistics (aggregated)
CREATE TABLE user_stats (
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

-- Workspace state persistence
CREATE TABLE workspace_state (
    user_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,            -- JSON blob of workspace state
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Session context (token tracking per session)
CREATE TABLE session_context (
    session_id TEXT PRIMARY KEY,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Schema version tracking (for migrations)
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
```

### Full-Text Search

```sql
-- FTS5 virtual table for conversation search
CREATE VIRTUAL TABLE conversations_fts USING fts5(
  content,
  session_id UNINDEXED,
  role UNINDEXED,
  timestamp UNINDEXED,
  content='conversations',
  content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER conversations_ai AFTER INSERT ON conversations BEGIN
  INSERT INTO conversations_fts(rowid, content, session_id, role, timestamp)
  VALUES (new.id, new.content, new.session_id, new.role, new.timestamp);
END;

CREATE TRIGGER conversations_ad AFTER DELETE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, content, session_id, role, timestamp)
  VALUES('delete', old.id, old.content, old.session_id, old.role, old.timestamp);
END;

CREATE TRIGGER conversations_au AFTER UPDATE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, content, session_id, role, timestamp)
  VALUES('delete', old.id, old.content, old.session_id, old.role, old.timestamp);
  INSERT INTO conversations_fts(rowid, content, session_id, role, timestamp)
  VALUES (new.id, new.content, new.session_id, new.role, new.timestamp);
END;
```

## Common Queries

### Conversations

**Recent conversations (non-archived)**:
```bash
sqlite3 data/ccplus.db "SELECT session_id, role, substr(content, 1, 80), timestamp, project_path FROM conversations WHERE archived = 0 OR archived IS NULL ORDER BY timestamp DESC LIMIT 20;"
```

**Sessions by project**:
```bash
sqlite3 data/ccplus.db "SELECT DISTINCT project_path, COUNT(DISTINCT session_id) as sessions FROM conversations WHERE project_path IS NOT NULL GROUP BY project_path ORDER BY sessions DESC;"
```

**Full-text search in conversations**:
```bash
sqlite3 data/ccplus.db "SELECT c.session_id, c.role, substr(c.content, 1, 100), c.timestamp FROM conversations_fts JOIN conversations c ON conversations_fts.rowid = c.id WHERE conversations_fts MATCH 'your search terms' LIMIT 20;"
```

### Tool Usage

**Tool usage summary**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, COUNT(*) as count, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures, AVG(duration_ms) as avg_duration FROM tool_usage GROUP BY tool_name ORDER BY count DESC;"
```

**Agent hierarchy for a session**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, tool_use_id, parent_agent_id, agent_type, success, duration_ms, description FROM tool_usage WHERE session_id = 'SESSION_ID' ORDER BY timestamp;"
```

**Agent usage statistics**:
```bash
sqlite3 data/ccplus.db "SELECT agent_type, COUNT(*) as invocations, AVG(input_tokens) as avg_input, AVG(output_tokens) as avg_output FROM tool_usage WHERE agent_type IS NOT NULL GROUP BY agent_type ORDER BY invocations DESC;"
```

**Errors**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, error, error_category, timestamp FROM tool_usage WHERE error IS NOT NULL ORDER BY timestamp DESC LIMIT 20;"
```

### Images

**Images by session**:
```bash
sqlite3 data/ccplus.db "SELECT id, filename, mime_type, size, uploaded_at FROM images WHERE session_id = 'SESSION_ID' ORDER BY uploaded_at;"
```

**Total image storage**:
```bash
sqlite3 data/ccplus.db "SELECT COUNT(*) as image_count, SUM(size) as total_bytes FROM images;"
```

### User Stats

**User activity summary**:
```bash
sqlite3 data/ccplus.db "SELECT user_id, total_sessions, total_queries, total_input_tokens, total_output_tokens, total_cost FROM user_stats;"
```

### Session Context

**Token usage per session**:
```bash
sqlite3 data/ccplus.db "SELECT session_id, input_tokens, model, updated_at FROM session_context ORDER BY input_tokens DESC LIMIT 20;"
```
