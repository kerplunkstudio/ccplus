import { getDb } from "./connection.js";

export function isSessionImported(jsonlSessionId: string): boolean {
  const database = getDb();
  const row = database.prepare('SELECT 1 FROM imported_sessions WHERE jsonl_session_id = ?').get(jsonlSessionId);
  return !!row;
}

export function recordImportedSession(params: {
  jsonlSessionId: string;
  projectPath: string;
  messageCount: number;
  queryCount: number;
  toolCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
}): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO imported_sessions (jsonl_session_id, project_path, message_count, query_count, tool_count, first_timestamp, last_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(params.jsonlSessionId, params.projectPath, params.messageCount, params.queryCount, params.toolCount, params.firstTimestamp, params.lastTimestamp);
}

export function insertImportedConversation(params: {
  sessionId: string;
  role: string;
  content: string;
  timestamp: string;
  projectPath: string;
}): void {
  const database = getDb();
  // Convert ISO UTC timestamp to local time format matching schema default
  const localTimestamp = params.timestamp.includes('T')
    ? new Date(params.timestamp).toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).replace('T', ' ')
    : params.timestamp;
  database.prepare(`
    INSERT INTO conversations (session_id, user_id, role, content, timestamp, project_path, source)
    VALUES (?, 'imported', ?, ?, ?, ?, 'imported')
  `).run(params.sessionId, params.role, params.content, localTimestamp, params.projectPath);
}

export function insertImportedQueryUsage(params: {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
  projectPath: string;
  timestamp: string;
}): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO query_usage (session_id, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd, duration_ms, model, project_path, timestamp, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported')
  `).run(params.sessionId, params.inputTokens, params.outputTokens, params.cacheReadInputTokens, params.cacheCreationInputTokens, params.costUsd, params.durationMs, params.model, params.projectPath, params.timestamp);
}

export function insertImportedToolUsage(params: {
  sessionId: string;
  toolName: string;
  timestamp: string;
  success: boolean;
  parameters?: string;
}): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO tool_usage (session_id, tool_name, timestamp, success, parameters, source)
    VALUES (?, ?, ?, ?, ?, 'imported')
  `).run(params.sessionId, params.toolName, params.timestamp, params.success ? 1 : 0, params.parameters || null);
}

export function getImportStatus(): { totalImported: number; totalNative: number; lastImportedAt: string | null } {
  const database = getDb();
  const imported = database.prepare('SELECT COUNT(*) as count FROM imported_sessions').get() as { count: number };
  const native = database.prepare("SELECT COUNT(DISTINCT session_id) as count FROM conversations WHERE source = 'native'").get() as { count: number };
  const lastImport = database.prepare('SELECT MAX(imported_at) as last_at FROM imported_sessions').get() as { last_at: string | null };
  return {
    totalImported: imported.count,
    totalNative: native.count,
    lastImportedAt: lastImport.last_at,
  };
}
