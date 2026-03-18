import Database from "better-sqlite3";
import path from "path";
import * as config from "./config.js";

let db: Database.Database | null = null;

// Migration definitions (version → SQL)
interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
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
];

function getCurrentSchemaVersion(database: Database.Database): number {
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

function applyMigrations(database: Database.Database): void {
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

function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.DATABASE_PATH);
    db.pragma("journal_mode = WAL");
    applyMigrations(db);
  }
  return db;
}

export function close(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// --- Message operations ---

export function recordMessage(
  sessionId: string,
  userId: string,
  role: string,
  content: string,
  sdkSessionId?: string,
  projectPath?: string,
  imageIds?: string[],
): Record<string, unknown> {
  const d = getDb();
  const imagesJson = imageIds ? JSON.stringify(imageIds) : null;
  const stmt = d.prepare(`
    INSERT INTO conversations (session_id, user_id, role, content, sdk_session_id, project_path, images)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(sessionId, userId, role, content, sdkSessionId ?? null, projectPath ?? null, imagesJson);
  const row = d.prepare("SELECT * FROM conversations WHERE id = ?").get(info.lastInsertRowid) as Record<string, unknown>;
  return row;
}

export function updateMessage(messageId: number, content: string, sdkSessionId?: string): void {
  const d = getDb();
  if (sdkSessionId) {
    d.prepare("UPDATE conversations SET content = ?, sdk_session_id = ? WHERE id = ?")
      .run(content, sdkSessionId, messageId);
  } else {
    d.prepare("UPDATE conversations SET content = ? WHERE id = ?")
      .run(content, messageId);
  }
}

export function getConversationHistory(sessionId: string, limit: number = 50): Record<string, unknown>[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM conversations
    WHERE session_id = ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(sessionId, limit) as Record<string, unknown>[];

  return rows.map((row) => {
    const msg = { ...row };
    if (msg.images && typeof msg.images === "string") {
      try {
        const imageIds = JSON.parse(msg.images as string) as string[];
        msg.images = getMessageImages(imageIds);
      } catch {
        msg.images = [];
      }
    } else {
      msg.images = [];
    }
    return msg;
  });
}

// --- Tool event operations ---

export function recordToolEvent(
  sessionId: string,
  toolName: string,
  toolUseId: string,
  parentAgentId?: string,
  agentType?: string,
  success?: boolean | null,
  error?: string | null,
  durationMs?: number | null,
  parameters?: string | Record<string, unknown> | null,
  inputTokens?: number | null,
  outputTokens?: number | null,
  description?: string | null,
): Record<string, unknown> {
  const d = getDb();
  const paramsJson = parameters !== null && parameters !== undefined
    ? (typeof parameters === "string" ? parameters : JSON.stringify(parameters))
    : null;
  const stmt = d.prepare(`
    INSERT INTO tool_usage
      (session_id, tool_name, tool_use_id, parent_agent_id, agent_type,
       success, error, duration_ms, parameters, input_tokens, output_tokens, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    sessionId, toolName, toolUseId,
    parentAgentId ?? null, agentType ?? null,
    success === null || success === undefined ? null : (success ? 1 : 0),
    error ?? null, durationMs ?? null,
    paramsJson, inputTokens ?? null, outputTokens ?? null,
    description ?? null,
  );
  const row = d.prepare("SELECT * FROM tool_usage WHERE id = ?").get(info.lastInsertRowid) as Record<string, unknown>;
  return row;
}

export function updateToolEvent(
  sessionId: string,
  toolUseId: string,
  success?: boolean | null,
  error?: string | null,
  durationMs?: number | null,
  summary?: string | null,
): void {
  const d = getDb();
  d.prepare(`
    UPDATE tool_usage
    SET success = ?, error = ?, duration_ms = ?, summary = COALESCE(?, summary)
    WHERE session_id = ? AND tool_use_id = ?
  `).run(
    success === null || success === undefined ? null : (success ? 1 : 0),
    error ?? null, durationMs ?? null, summary ?? null, sessionId, toolUseId
  );
}

export function getToolEvents(sessionId: string, limit: number = 200): Record<string, unknown>[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM tool_usage
    WHERE session_id = ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(sessionId, limit) as Record<string, unknown>[];

  return rows.map((row) => {
    const entry = { ...row };
    if (entry.parameters && typeof entry.parameters === "string") {
      try {
        entry.parameters = JSON.parse(entry.parameters as string);
      } catch {
        // keep as string
      }
    }
    return entry;
  });
}

// --- Session operations ---

export function getSessionsList(limit: number = 50, projectPath?: string, includeArchived: boolean = false): Record<string, unknown>[] {
  const d = getDb();
  const archivedClause = includeArchived ? "" : "AND (c1.archived = 0 OR c1.archived IS NULL)";
  const projectFilter = projectPath ? "WHERE project_path = ?" : "";
  const params: unknown[] = projectPath ? [projectPath, limit] : [limit];

  const rows = d.prepare(`
    WITH session_data AS (
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
      WHERE 1=1 ${archivedClause}
      GROUP BY session_id
    )
    SELECT * FROM session_data
    ${projectFilter}
    ORDER BY last_activity DESC
    LIMIT ?
  `).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const entry = { ...row };
    if (entry.last_user_message && typeof entry.last_user_message === "string" && (entry.last_user_message as string).length > 80) {
      entry.last_user_message = (entry.last_user_message as string).slice(0, 80) + "...";
    }
    return entry;
  });
}

export function getLastSdkSessionId(sessionId: string): string | null {
  const d = getDb();
  const row = d.prepare(`
    SELECT sdk_session_id FROM conversations
    WHERE session_id = ? AND sdk_session_id IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(sessionId) as { sdk_session_id: string } | undefined;
  return row?.sdk_session_id ?? null;
}

export function archiveSession(sessionId: string): boolean {
  const d = getDb();
  try {
    d.prepare("UPDATE conversations SET archived = 1 WHERE session_id = ?").run(sessionId);
    d.prepare("DELETE FROM images WHERE session_id = ?").run(sessionId);
    return true;
  } catch {
    return false;
  }
}

// --- Stats ---

export function getStats(): Record<string, unknown> {
  const d = getDb();
  const totalConversations = (d.prepare("SELECT COUNT(*) as c FROM conversations").get() as { c: number }).c;
  const totalToolEvents = (d.prepare("SELECT COUNT(*) as c FROM tool_usage").get() as { c: number }).c;

  const toolRows = d.prepare(`
    SELECT tool_name, COUNT(*) as count
    FROM tool_usage
    GROUP BY tool_name
    ORDER BY count DESC
  `).all() as { tool_name: string; count: number }[];

  const eventsByTool: Record<string, number> = {};
  for (const row of toolRows) {
    eventsByTool[row.tool_name] = row.count;
  }

  return {
    total_conversations: totalConversations,
    total_tool_events: totalToolEvents,
    events_by_tool: eventsByTool,
  };
}

// --- Images ---

export function storeImage(imageId: string, filename: string, mimeType: string, size: number, data: Buffer, sessionId: string): Record<string, unknown> {
  const d = getDb();
  d.prepare(`
    INSERT INTO images (id, filename, mime_type, size, data, session_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(imageId, filename, mimeType, size, data, sessionId);
  return {
    id: imageId,
    filename,
    mime_type: mimeType,
    size,
    url: `/api/images/${imageId}`,
  };
}

export function getImage(imageId: string): Record<string, unknown> | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM images WHERE id = ?").get(imageId) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function getMessageImages(imageIds: string[]): Record<string, unknown>[] {
  if (!imageIds.length) return [];
  const d = getDb();
  const placeholders = imageIds.map(() => "?").join(",");
  const rows = d.prepare(
    `SELECT id, filename, mime_type, size FROM images WHERE id IN (${placeholders})`
  ).all(...imageIds) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...row,
    url: `/api/images/${(row as { id: string }).id}`,
  }));
}

// --- User stats ---

export function getUserStats(userId: string): Record<string, unknown> {
  const d = getDb();
  let row = d.prepare("SELECT * FROM user_stats WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  if (!row) {
    d.prepare("INSERT INTO user_stats (user_id) VALUES (?)").run(userId);
    row = d.prepare("SELECT * FROM user_stats WHERE user_id = ?").get(userId) as Record<string, unknown>;
  }
  return row;
}

export function incrementUserStats(
  userId: string,
  sessions: number = 0,
  queries: number = 0,
  durationMs: number = 0,
  cost: number = 0,
  inputTokens: number = 0,
  outputTokens: number = 0,
  linesOfCode: number = 0,
): void {
  const d = getDb();
  d.prepare(`
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
  `).run(userId, sessions, queries, durationMs, cost, inputTokens, outputTokens, linesOfCode);
}

// --- Workspace state ---

export function getWorkspaceState(userId: string): Record<string, unknown> | null {
  const d = getDb();
  const row = d.prepare("SELECT state FROM workspace_state WHERE user_id = ?").get(userId) as { state: string } | undefined;
  if (row) {
    try {
      return JSON.parse(row.state);
    } catch {
      return null;
    }
  }
  return null;
}

export function saveWorkspaceState(userId: string, state: Record<string, unknown>): void {
  const d = getDb();
  const stateJson = JSON.stringify(state);
  d.prepare(`
    INSERT INTO workspace_state (user_id, state)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      state = excluded.state,
      updated_at = datetime('now', 'localtime')
  `).run(userId, stateJson);
}

// --- Session context ---

export function updateSessionContext(sessionId: string, inputTokens: number, model: string | null): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO session_context (session_id, input_tokens, model, updated_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(session_id) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).run(sessionId, inputTokens, model);
}

export function getSessionContext(sessionId: string): { input_tokens: number; model: string | null } | null {
  const d = getDb();
  const row = d.prepare(`SELECT input_tokens, model FROM session_context WHERE session_id = ?`).get(sessionId) as { input_tokens: number; model: string | null } | undefined;
  return row ?? null;
}

// --- Session duplication ---

export function duplicateSession(sourceSessionId: string, newSessionId: string, userId: string): { conversations: number; toolEvents: number; images: number } {
  const d = getDb();

  // Copy conversations (update session_id to new, keep everything else)
  const convResult = d.prepare(`
    INSERT INTO conversations (session_id, user_id, role, content, timestamp, sdk_session_id, project_path, archived, images)
    SELECT ?, user_id, role, content, timestamp, sdk_session_id, project_path, 0, images
    FROM conversations WHERE session_id = ? ORDER BY id
  `).run(newSessionId, sourceSessionId);

  // Copy tool_usage (update session_id, keep parent relationships intact)
  const toolResult = d.prepare(`
    INSERT INTO tool_usage (timestamp, session_id, tool_name, duration_ms, success, error, error_category, parameters, tool_use_id, parent_agent_id, agent_type, input_tokens, output_tokens, description)
    SELECT timestamp, ?, tool_name, duration_ms, success, error, error_category, parameters, tool_use_id, parent_agent_id, agent_type, input_tokens, output_tokens, description
    FROM tool_usage WHERE session_id = ? ORDER BY id
  `).run(newSessionId, sourceSessionId);

  // Copy images (generate new UUIDs to avoid UNIQUE constraint violations)
  const sourceImages = d.prepare(`SELECT * FROM images WHERE session_id = ?`).all(sourceSessionId) as Array<{
    id: string;
    filename: string;
    mime_type: string;
    size: number;
    data: Buffer;
    uploaded_at: string;
  }>;

  let imagesCopied = 0;
  const insertImage = d.prepare(`
    INSERT INTO images (id, filename, mime_type, size, data, uploaded_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const img of sourceImages) {
    // Generate new UUID for the duplicated image
    const newImageId = `${img.id.split('-')[0]}-dup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    insertImage.run(newImageId, img.filename, img.mime_type, img.size, img.data, img.uploaded_at, newSessionId);
    imagesCopied++;
  }

  const imageResult = { changes: imagesCopied };

  return {
    conversations: convResult.changes,
    toolEvents: toolResult.changes,
    images: imageResult.changes,
  };
}

// --- Utility ---

export function markOrphanedToolEvents(): number {
  const d = getDb();
  const info = d.prepare(`
    UPDATE tool_usage
    SET success = 0, error = 'Server restarted', duration_ms = 0
    WHERE success IS NULL
  `).run();
  return info.changes;
}

export function cleanupOrphanedImages(): number {
  const d = getDb();
  const info = d.prepare(`
    DELETE FROM images
    WHERE session_id NOT IN (
      SELECT DISTINCT session_id FROM conversations
    )
  `).run();
  return info.changes;
}

export function isFirstRun(): boolean {
  const d = getDb();
  const row = d.prepare(
    "SELECT COUNT(*) as c FROM conversations WHERE archived = 0 OR archived IS NULL"
  ).get() as { c: number };
  return row.c === 0;
}

// --- Search ---

export function searchConversations(query: string, projectPath?: string, limit: number = 50): Record<string, unknown>[] {
  const d = getDb();
  const searchPattern = `%${query}%`;
  const projectFilter = projectPath ? "AND project_path = ?" : "";
  const params: unknown[] = projectPath ? [searchPattern, projectPath, limit] : [searchPattern, limit];

  const rows = d.prepare(`
    WITH session_matches AS (
      SELECT
        session_id,
        content,
        role,
        timestamp,
        (SELECT content FROM conversations c2
         WHERE c2.session_id = c1.session_id AND c2.role = 'user'
         ORDER BY c2.timestamp ASC LIMIT 1) as session_label
      FROM conversations c1
      WHERE content LIKE ?
      AND (archived = 0 OR archived IS NULL)
      ${projectFilter}
      ORDER BY timestamp DESC
    )
    SELECT * FROM session_matches
    LIMIT ?
  `).all(...params) as Array<{
    session_id: string;
    content: string;
    role: string;
    timestamp: string;
    session_label: string;
  }>;

  // Group by session_id and create snippets
  const sessionMap = new Map<string, {
    session_id: string;
    session_label: string;
    matches: Array<{ content: string; role: string; timestamp: string }>;
  }>();

  for (const row of rows) {
    if (!sessionMap.has(row.session_id)) {
      sessionMap.set(row.session_id, {
        session_id: row.session_id,
        session_label: row.session_label || "Untitled session",
        matches: [],
      });
    }

    // Create snippet with context around the match
    const content = row.content;
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerContent.indexOf(lowerQuery);

    let snippet = content;
    if (matchIndex !== -1 && content.length > 200) {
      const contextStart = Math.max(0, matchIndex - 50);
      const contextEnd = Math.min(content.length, matchIndex + query.length + 150);
      snippet = (contextStart > 0 ? "..." : "") +
                content.slice(contextStart, contextEnd) +
                (contextEnd < content.length ? "..." : "");
    } else if (content.length > 200) {
      snippet = content.slice(0, 200) + "...";
    }

    sessionMap.get(row.session_id)!.matches.push({
      content: snippet,
      role: row.role,
      timestamp: row.timestamp,
    });
  }

  return Array.from(sessionMap.values());
}

export function semanticSearchConversations(query: string, limit: number = 20): Array<{
  session_id: string
  role: string
  content: string
  timestamp: string
  rank: number
}> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const d = getDb();
  const stmt = d.prepare(`
    SELECT c.session_id, c.role, c.content, c.timestamp, conversations_fts.rank
    FROM conversations_fts
    JOIN conversations c ON conversations_fts.rowid = c.id
    WHERE conversations_fts MATCH ?
    AND (c.archived = 0 OR c.archived IS NULL)
    ORDER BY conversations_fts.rank
    LIMIT ?
  `);
  return stmt.all(query.trim(), limit) as Array<{
    session_id: string
    role: string
    content: string
    timestamp: string
    rank: number
  }>;
}

// --- Insights (analytics) ---

export function getInsights(days: number = 30, projectPath?: string): Record<string, unknown> {
  const d = getDb();

  const endDate = (d.prepare("SELECT date('now', 'localtime') as d").get() as { d: string }).d;
  const startDate = (d.prepare("SELECT date('now', 'localtime', ?) as d").get(`-${days} days`) as { d: string }).d;
  const prevStart = (d.prepare("SELECT date('now', 'localtime', ?) as d").get(`-${days * 2} days`) as { d: string }).d;
  const prevEnd = (d.prepare("SELECT date('now', 'localtime', ?) as d").get(`-${days + 1} days`) as { d: string }).d;

  // Build project filters
  const convProjectFilter = projectPath ? "AND project_path = ?" : "";
  const convProjectParams = projectPath ? [projectPath] : [];
  const toolProjectFilter = projectPath
    ? `AND session_id IN (
        SELECT DISTINCT session_id FROM conversations
        WHERE project_path = ? AND (archived = 0 OR archived IS NULL)
      )`
    : "";
  const toolProjectParams = projectPath ? [projectPath] : [];

  // Conversation summary
  const convSummary = d.prepare(`
    SELECT
      COUNT(DISTINCT session_id) as total_sessions,
      COUNT(CASE WHEN role = 'user' THEN 1 END) as total_queries
    FROM conversations
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND (archived = 0 OR archived IS NULL)
    ${convProjectFilter}
  `).get(startDate, endDate, ...convProjectParams) as { total_sessions: number; total_queries: number };

  // Tool summary
  const toolSummary = d.prepare(`
    SELECT
      COUNT(*) as total_tool_calls,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    ${toolProjectFilter}
  `).get(startDate, endDate, ...toolProjectParams) as { total_tool_calls: number; total_input_tokens: number; total_output_tokens: number };

  // Previous period
  const prevSummary = d.prepare(`
    SELECT COUNT(CASE WHEN role = 'user' THEN 1 END) as prev_queries
    FROM conversations
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND (archived = 0 OR archived IS NULL)
    ${convProjectFilter}
  `).get(prevStart, prevEnd, ...convProjectParams) as { prev_queries: number };

  const inputTokens = toolSummary.total_input_tokens || 0;
  const outputTokens = toolSummary.total_output_tokens || 0;
  const totalCost = (inputTokens / 1_000_000 * 3.0) + (outputTokens / 1_000_000 * 15.0);

  const currentQueries = convSummary.total_queries || 0;
  const prevQueries = prevSummary.prev_queries || 0;
  const changePct = prevQueries > 0
    ? Math.round(((currentQueries - prevQueries) / prevQueries) * 100)
    : 0;

  // Daily breakdown - conversations
  const dailyConvRows = d.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(CASE WHEN role = 'user' THEN 1 END) as queries,
      COUNT(DISTINCT session_id) as sessions
    FROM conversations
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND (archived = 0 OR archived IS NULL)
    ${convProjectFilter}
    GROUP BY date(timestamp)
    ORDER BY date(timestamp) ASC
  `).all(startDate, endDate, ...convProjectParams) as { date: string; queries: number; sessions: number }[];

  // Daily breakdown - tools
  const dailyToolRows = d.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(*) as tool_calls,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    ${toolProjectFilter}
    GROUP BY date(timestamp)
    ORDER BY date(timestamp) ASC
  `).all(startDate, endDate, ...toolProjectParams) as { date: string; tool_calls: number; input_tokens: number; output_tokens: number }[];

  // Merge daily data
  const convByDate = new Map(dailyConvRows.map((r) => [r.date, r]));
  const toolByDate = new Map(dailyToolRows.map((r) => [r.date, r]));
  const allDates = [...new Set([...convByDate.keys(), ...toolByDate.keys()])].sort();

  const daily = allDates.map((date) => {
    const c = convByDate.get(date);
    const t = toolByDate.get(date);
    const dayInput = t?.input_tokens || 0;
    const dayOutput = t?.output_tokens || 0;
    const dayCost = (dayInput / 1_000_000 * 3.0) + (dayOutput / 1_000_000 * 15.0);
    return {
      date,
      queries: c?.queries || 0,
      tool_calls: t?.tool_calls || 0,
      cost: Math.round(dayCost * 100) / 100,
      input_tokens: dayInput,
      output_tokens: dayOutput,
      sessions: c?.sessions || 0,
    };
  });

  // By project
  const byProjectRows = d.prepare(`
    SELECT
      project_path,
      COUNT(CASE WHEN role = 'user' THEN 1 END) as queries,
      COUNT(DISTINCT session_id) as sessions
    FROM conversations
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND (archived = 0 OR archived IS NULL)
    AND project_path IS NOT NULL
    ${convProjectFilter}
    GROUP BY project_path
    ORDER BY queries DESC
  `).all(startDate, endDate, ...convProjectParams) as { project_path: string; queries: number; sessions: number }[];

  const byProject = byProjectRows.map((row) => {
    const projectName = row.project_path ? path.basename(row.project_path) : "Unknown";
    const projTokens = d.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens
      FROM tool_usage
      WHERE date(timestamp) >= ? AND date(timestamp) <= ?
      AND session_id IN (
        SELECT DISTINCT session_id FROM conversations
        WHERE project_path = ? AND (archived = 0 OR archived IS NULL)
      )
    `).get(startDate, endDate, row.project_path) as { input_tokens: number; output_tokens: number };

    const projInput = projTokens.input_tokens || 0;
    const projOutput = projTokens.output_tokens || 0;
    const projCost = (projInput / 1_000_000 * 3.0) + (projOutput / 1_000_000 * 15.0);

    return {
      project: projectName,
      path: row.project_path,
      queries: row.queries,
      cost: Math.round(projCost * 100) / 100,
    };
  });

  // By tool
  const byToolRows = d.prepare(`
    SELECT
      tool_name,
      COUNT(*) as count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND tool_name NOT LIKE 'toolu_%'
    ${toolProjectFilter}
    GROUP BY tool_name
    ORDER BY count DESC
  `).all(startDate, endDate, ...toolProjectParams) as {
    tool_name: string;
    count: number;
    success_count: number;
    avg_duration_ms: number;
    total_input_tokens: number;
    total_output_tokens: number;
    error_count: number;
  }[];

  const byTool = byToolRows.map((row) => {
    const total = row.count || 0;
    const success = row.success_count || 0;
    const successRate = total > 0 ? Math.round((success / total) * 100) / 100 : 0;
    return {
      tool: row.tool_name,
      count: total,
      success_rate: successRate,
      avg_duration_ms: Math.round((row.avg_duration_ms || 0) * 100) / 100,
      total_input_tokens: row.total_input_tokens || 0,
      total_output_tokens: row.total_output_tokens || 0,
      error_count: row.error_count || 0,
    };
  });

  // By error category
  const byErrorCategoryRows = d.prepare(`
    SELECT
      error_category,
      COUNT(*) as count
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND error_category IS NOT NULL
    ${toolProjectFilter}
    GROUP BY error_category
    ORDER BY count DESC
  `).all(startDate, endDate, ...toolProjectParams) as { error_category: string; count: number }[];

  const byErrorCategory = byErrorCategoryRows.map((row) => ({
    category: row.error_category,
    count: row.count,
  }));

  // By agent type
  const byAgentTypeRows = d.prepare(`
    SELECT
      agent_type,
      COUNT(*) as count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND agent_type IS NOT NULL
    ${toolProjectFilter}
    GROUP BY agent_type
    ORDER BY count DESC
  `).all(startDate, endDate, ...toolProjectParams) as {
    agent_type: string;
    count: number;
    success_count: number;
    avg_duration_ms: number;
  }[];

  const byAgentType = byAgentTypeRows.map((row) => ({
    agent_type: row.agent_type,
    count: row.count,
    success_count: row.success_count,
    avg_duration_ms: Math.round((row.avg_duration_ms || 0) * 100) / 100,
  }));

  // Hourly activity
  const hourlyActivityRows = d.prepare(`
    SELECT
      CAST(strftime('%H', timestamp) AS INTEGER) as hour,
      COUNT(CASE WHEN role = 'user' THEN 1 END) as queries
    FROM conversations
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND (archived = 0 OR archived IS NULL)
    ${convProjectFilter}
    GROUP BY hour
    ORDER BY hour ASC
  `).all(startDate, endDate, ...convProjectParams) as { hour: number; queries: number }[];

  const hourlyActivityMap = new Map(hourlyActivityRows.map((r) => [r.hour, r.queries]));
  const hourlyActivity = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    queries: hourlyActivityMap.get(i) || 0,
  }));

  // Enhanced summary metrics
  const totalErrors = d.prepare(`
    SELECT COUNT(*) as count
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND success = 0
    ${toolProjectFilter}
  `).get(startDate, endDate, ...toolProjectParams) as { count: number };

  const avgCostPerQuery = currentQueries > 0 ? Math.round((totalCost / currentQueries) * 100) / 100 : 0;
  const avgTokensPerQuery = currentQueries > 0
    ? Math.round(((inputTokens + outputTokens) / currentQueries) * 100) / 100
    : 0;
  const avgQueriesPerSession = convSummary.total_sessions > 0
    ? Math.round((currentQueries / convSummary.total_sessions) * 100) / 100
    : 0;

  return {
    period: { start: startDate, end: endDate, days },
    summary: {
      total_queries: currentQueries,
      total_cost: Math.round(totalCost * 100) / 100,
      total_input_tokens: inputTokens,
      total_output_tokens: outputTokens,
      total_tool_calls: toolSummary.total_tool_calls || 0,
      total_sessions: convSummary.total_sessions || 0,
      change_pct: changePct,
      avg_cost_per_query: avgCostPerQuery,
      avg_tokens_per_query: avgTokensPerQuery,
      avg_queries_per_session: avgQueriesPerSession,
      total_errors: totalErrors.count || 0,
    },
    daily,
    by_project: byProject,
    by_tool: byTool,
    by_error_category: byErrorCategory,
    by_agent_type: byAgentType,
    hourly_activity: hourlyActivity,
  };
}
