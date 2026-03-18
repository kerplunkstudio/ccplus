# Database Schema

**Location**: `data/ccplus.db` (SQLite, WAL mode)

## Tables

```sql
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,       -- Browser session ID (session_<timestamp>_<random>)
    user_id TEXT NOT NULL,          -- "local" in local mode
    role TEXT NOT NULL,             -- "user" or "assistant"
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    sdk_session_id TEXT             -- SDK session UUID (set on assistant messages)
);
CREATE INDEX idx_conversations_session ON conversations(session_id, timestamp);

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
    output_tokens INTEGER
);
CREATE INDEX idx_tool_usage_session ON tool_usage(session_id, timestamp);
CREATE INDEX idx_tool_usage_parent ON tool_usage(parent_agent_id);
```

## Common Queries

**Recent conversations**:
```bash
sqlite3 data/ccplus.db "SELECT session_id, role, substr(content, 1, 80), timestamp FROM conversations ORDER BY timestamp DESC LIMIT 20;"
```

**Tool usage summary**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, COUNT(*) as count, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures FROM tool_usage GROUP BY tool_name ORDER BY count DESC;"
```

**Agent hierarchy for a session**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, tool_use_id, parent_agent_id, agent_type, success, duration_ms FROM tool_usage WHERE session_id = 'SESSION_ID' ORDER BY timestamp;"
```

**Errors**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, error, timestamp FROM tool_usage WHERE error IS NOT NULL ORDER BY timestamp DESC LIMIT 20;"
```
