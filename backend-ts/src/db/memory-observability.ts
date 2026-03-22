import { getDb } from "./connection.js";

/**
 * Record a memory distillation event
 */
export function recordDistillation(
  sessionId: string,
  trigger: string,
  success: boolean,
  memoryCount: number,
  durationMs: number | null,
  errorMsg: string | null
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO memory_distillations (session_id, trigger, success, memory_count, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(sessionId, trigger, success ? 1 : 0, memoryCount, durationMs, errorMsg);
}

/**
 * Get distillation statistics for the last N hours
 */
export function getDistillationStats(hours: number = 24): {
  total: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
} {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration_ms
    FROM memory_distillations
    WHERE created_at >= datetime('now', '-' || ? || ' hours', 'localtime')
  `);
  const result = stmt.get(hours) as {
    total: number;
    successes: number;
    failures: number;
    avg_duration_ms: number | null;
  };

  return {
    total: result.total ?? 0,
    successes: result.successes ?? 0,
    failures: result.failures ?? 0,
    avgDurationMs: Math.round(result.avg_duration_ms ?? 0),
  };
}

/**
 * Get recent distillation events
 */
export function getRecentDistillations(limit: number = 20): Array<{
  session_id: string;
  trigger: string;
  success: number;
  memory_count: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT session_id, trigger, success, memory_count, duration_ms, error, created_at
    FROM memory_distillations
    ORDER BY id DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Array<{
    session_id: string;
    trigger: string;
    success: number;
    memory_count: number;
    duration_ms: number | null;
    error: string | null;
    created_at: string;
  }>;
}
