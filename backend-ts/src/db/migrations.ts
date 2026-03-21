import Database from "better-sqlite3";

// Migration definitions (version → SQL)
export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
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
    output_tokens INTEGER,
    description TEXT
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

CREATE TABLE IF NOT EXISTS workspace_state (
    user_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS session_context (
    session_id TEXT PRIMARY KEY,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`,
  },
  {
    version: 2,
    sql: `
-- Add description column for agent descriptions
ALTER TABLE tool_usage ADD COLUMN description TEXT;
`,
  },
  {
    version: 3,
    sql: `
-- Add summary column for agent output/summary
ALTER TABLE tool_usage ADD COLUMN summary TEXT;
`,
  },
  {
    version: 4,
    sql: `
-- Create FTS5 virtual table for conversations
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
  content,
  session_id UNINDEXED,
  role UNINDEXED,
  timestamp UNINDEXED,
  content='conversations',
  content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
  INSERT INTO conversations_fts(rowid, content, session_id, role, timestamp)
  VALUES (new.id, new.content, new.session_id, new.role, new.timestamp);
END;

CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, content, session_id, role, timestamp)
  VALUES('delete', old.id, old.content, old.session_id, old.role, old.timestamp);
END;

CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, content, session_id, role, timestamp)
  VALUES('delete', old.id, old.content, old.session_id, old.role, old.timestamp);
  INSERT INTO conversations_fts(rowid, content, session_id, role, timestamp)
  VALUES (new.id, new.content, new.session_id, new.role, new.timestamp);
END;

-- Rebuild FTS index from existing data
INSERT INTO conversations_fts(rowid, content, session_id, role, timestamp)
SELECT id, content, session_id, role, timestamp FROM conversations;
`,
  },
  {
    version: 5,
    sql: `
-- Rate limit events tracking
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  retry_after_ms INTEGER NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_timestamp ON rate_limit_events(timestamp);
`,
  },
  {
    version: 6,
    sql: `
-- Add cache token columns to tool_usage
ALTER TABLE tool_usage ADD COLUMN cache_read_input_tokens INTEGER;
ALTER TABLE tool_usage ADD COLUMN cache_creation_input_tokens INTEGER;
`,
  },
  {
    version: 7,
    sql: `
-- Create query_usage table for per-query token tracking
CREATE TABLE IF NOT EXISTS query_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  project_path TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_query_usage_timestamp ON query_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_query_usage_session ON query_usage(session_id);
`,
  },
  {
    version: 8,
    sql: `
-- Migration v8: Session import support
ALTER TABLE conversations ADD COLUMN source TEXT NOT NULL DEFAULT 'native';
ALTER TABLE query_usage ADD COLUMN source TEXT NOT NULL DEFAULT 'native';
ALTER TABLE tool_usage ADD COLUMN source TEXT NOT NULL DEFAULT 'native';

CREATE TABLE IF NOT EXISTS imported_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jsonl_session_id TEXT NOT NULL UNIQUE,
  project_path TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  message_count INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  tool_count INTEGER NOT NULL DEFAULT 0,
  first_timestamp TEXT,
  last_timestamp TEXT
);
CREATE INDEX IF NOT EXISTS idx_imported_sessions_id ON imported_sessions(jsonl_session_id);
`,
  },
];

export function getCurrentSchemaVersion(database: Database.Database): number {
  // Check if schema_version table exists
  const tableExists = database.prepare(`
    SELECT COUNT(*) as c FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_version'
  `).get() as { c: number };

  if (tableExists.c === 0) {
    // Check if this is an existing database with tables already created
    const conversationsExists = database.prepare(`
      SELECT COUNT(*) as c FROM sqlite_master
      WHERE type = 'table' AND name = 'conversations'
    `).get() as { c: number };

    if (conversationsExists.c > 0) {
      // Existing database without schema_version table → mark as v1
      database.exec(`
        CREATE TABLE schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        INSERT INTO schema_version (version) VALUES (1);
      `);
      return 1;
    }

    // Brand new database
    return 0;
  }

  // Schema version table exists, get current version
  const row = database.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
  return row.v ?? 0;
}

export function applyMigrations(database: Database.Database): void {
  const currentVersion = getCurrentSchemaVersion(database);
  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    return;
  }

  // Create schema_version table if it doesn't exist (for brand new databases)
  if (currentVersion === 0) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);
  }

  // Apply each pending migration in a transaction
  for (const migration of pendingMigrations) {
    const transaction = database.transaction(() => {
      try {
        database.exec(migration.sql);
      } catch (err) {
        // If column already exists, this is fine (idempotent migrations)
        const errMsg = String(err);
        if (!errMsg.includes("duplicate column name")) {
          throw err;
        }
      }
      database.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
    });

    transaction();
  }
}
