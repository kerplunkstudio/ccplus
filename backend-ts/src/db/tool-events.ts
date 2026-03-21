import * as config from "../config.js";
import { getDb } from "./connection.js";

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
  cacheReadInputTokens?: number | null,
  cacheCreationInputTokens?: number | null,
): Record<string, unknown> {
  const d = getDb();
  const paramsJson = parameters !== null && parameters !== undefined
    ? (typeof parameters === "string" ? parameters : JSON.stringify(parameters))
    : null;
  const stmt = d.prepare(`
    INSERT INTO tool_usage
      (session_id, tool_name, tool_use_id, parent_agent_id, agent_type,
       success, error, duration_ms, parameters, input_tokens, output_tokens, description,
       cache_read_input_tokens, cache_creation_input_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    sessionId, toolName, toolUseId,
    parentAgentId ?? null, agentType ?? null,
    success === null || success === undefined ? null : (success ? 1 : 0),
    error ?? null, durationMs ?? null,
    paramsJson, inputTokens ?? null, outputTokens ?? null,
    description ?? null,
    cacheReadInputTokens ?? null, cacheCreationInputTokens ?? null,
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

export function getToolEvents(sessionId: string, limit: number = config.MAX_ACTIVITY_EVENTS_DEFAULT): Record<string, unknown>[] {
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

export function markOrphanedToolEvents(): number {
  const d = getDb();
  const info = d.prepare(`
    UPDATE tool_usage
    SET success = 0, error = 'Server restarted', duration_ms = 0
    WHERE success IS NULL
  `).run();
  return info.changes;
}
