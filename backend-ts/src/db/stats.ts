import { getDb } from "./connection.js";

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

export function recordRateLimitEvent(sessionId: string, retryAfterMs: number): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO rate_limit_events (session_id, retry_after_ms)
    VALUES (?, ?)
  `).run(sessionId, retryAfterMs);
}

export function getRateLimitEvents(days: number): Record<string, unknown>[] {
  const d = getDb();
  return d.prepare(`
    SELECT * FROM rate_limit_events
    WHERE timestamp >= datetime('now', '-' || ? || ' days')
    ORDER BY timestamp DESC
    LIMIT 100
  `).all(days) as Record<string, unknown>[];
}

export function recordQueryUsage(params: {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  durationMs: number;
  model: string | null;
  projectPath: string | null;
}): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO query_usage
      (session_id, input_tokens, output_tokens, cache_read_input_tokens,
       cache_creation_input_tokens, cost_usd, duration_ms, model, project_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.sessionId,
    params.inputTokens,
    params.outputTokens,
    params.cacheReadInputTokens,
    params.cacheCreationInputTokens,
    params.costUsd,
    params.durationMs,
    params.model,
    params.projectPath,
  );
}
