import { getDb } from "./connection.js";

// Types
export interface KairosAnalysis {
  readonly id: number;
  readonly session_id: string;
  readonly status: string;
  readonly task_intent: string | null;
  readonly actual_outcome: string;
  readonly outcome_reasoning: string | null;
  readonly follow_up_needed: number;
  readonly correlated_with: string;
  readonly prompt_issues: string | null;
  readonly recommendations: string | null;
  readonly analysis_model: string | null;
  readonly analysis_tokens: number;
  readonly analysis_cost_usd: number;
  readonly analysis_duration_ms: number;
  readonly created_at: string;
  readonly analyzed_at: string | null;
  readonly error: string | null;
}

export interface KairosCorrelation {
  readonly id: number;
  readonly source_session_id: string;
  readonly target_session_id: string;
  readonly relation_type: string;
  readonly confidence: number;
  readonly evidence: string | null;
  readonly created_at: string;
}

export interface KairosPromptChange {
  readonly id: number;
  readonly file_path: string;
  readonly change_type: string;
  readonly diff_before: string;
  readonly diff_after: string;
  readonly evidence_session_ids: string;
  readonly reasoning: string;
  readonly applied: number;
  readonly rolled_back_at: string | null;
  readonly rollback_reason: string | null;
  readonly created_at: string;
}

// Analysis functions
export function getUnanalyzedSessionIds(limit: number): string[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT session_id FROM fleet_sessions
    WHERE status IN ('failed', 'cancelled')
      AND session_id NOT IN (SELECT session_id FROM kairos_analyses)
      AND session_id NOT LIKE 'kairos-%'
    ORDER BY started_at ASC
    LIMIT ?
  `).all(limit) as Array<{ session_id: string }>;

  return rows.map((row) => row.session_id);
}

export function ensureAnalysisRecord(sessionId: string): void {
  const d = getDb();
  d.prepare(`
    INSERT OR IGNORE INTO kairos_analyses (session_id, status)
    VALUES (?, 'pending')
  `).run(sessionId);
}

export function markAnalysisStarted(sessionId: string, model: string): void {
  const d = getDb();
  d.prepare(`
    UPDATE kairos_analyses
    SET status = 'analyzing', analysis_model = ?
    WHERE session_id = ?
  `).run(model, sessionId);
}

/**
 * Mark a batch of sessions as analyzed (prevents re-processing).
 * Called by the daemon when a kairos session completes.
 */
export function markSessionsAnalyzed(sessionIds: readonly string[]): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO kairos_analyses (session_id, status, analyzed_at)
    VALUES (?, 'completed', datetime('now', 'localtime'))
  `);
  for (const id of sessionIds) {
    stmt.run(id);
  }
}

export function markAnalysisCompleted(
  sessionId: string,
  result: {
    taskIntent: string;
    actualOutcome: string;
    outcomeReasoning: string;
    followUpNeeded: boolean;
    correlatedWith: string[];
    promptIssues: unknown[];
    recommendations: unknown[];
    analysisTokens: number;
    analysisCostUsd: number;
    analysisDurationMs: number;
  }
): void {
  const d = getDb();
  d.prepare(`
    UPDATE kairos_analyses
    SET
      status = 'completed',
      task_intent = ?,
      actual_outcome = ?,
      outcome_reasoning = ?,
      follow_up_needed = ?,
      correlated_with = ?,
      prompt_issues = ?,
      recommendations = ?,
      analysis_tokens = ?,
      analysis_cost_usd = ?,
      analysis_duration_ms = ?,
      analyzed_at = datetime('now', 'localtime')
    WHERE session_id = ?
  `).run(
    result.taskIntent,
    result.actualOutcome,
    result.outcomeReasoning,
    result.followUpNeeded ? 1 : 0,
    JSON.stringify(result.correlatedWith),
    JSON.stringify(result.promptIssues),
    JSON.stringify(result.recommendations),
    result.analysisTokens,
    result.analysisCostUsd,
    result.analysisDurationMs,
    sessionId
  );
}

export function markAnalysisFailed(sessionId: string, error: string): void {
  const d = getDb();
  d.prepare(`
    UPDATE kairos_analyses
    SET status = 'failed', error = ?, analyzed_at = datetime('now', 'localtime')
    WHERE session_id = ?
  `).run(error, sessionId);
}

export function getAnalysis(sessionId: string): KairosAnalysis | null {
  const d = getDb();
  const row = d.prepare(`
    SELECT * FROM kairos_analyses WHERE session_id = ?
  `).get(sessionId) as KairosAnalysis | undefined;

  return row ?? null;
}

export function getAnalyses(options?: {
  status?: string;
  outcome?: string;
  limit?: number;
}): KairosAnalysis[] {
  const d = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options?.outcome) {
    conditions.push("actual_outcome = ?");
    params.push(options.outcome);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = options?.limit ? `LIMIT ${options.limit}` : "";

  const rows = d.prepare(`
    SELECT * FROM kairos_analyses
    ${whereClause}
    ORDER BY created_at DESC
    ${limitClause}
  `).all(...params) as KairosAnalysis[];

  return rows;
}

// Correlation functions
export function addCorrelation(params: {
  sourceSessionId: string;
  targetSessionId: string;
  relationType: string;
  confidence: number;
  evidence: string;
}): void {
  const d = getDb();
  d.prepare(`
    INSERT OR IGNORE INTO kairos_correlations (
      source_session_id,
      target_session_id,
      relation_type,
      confidence,
      evidence
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    params.sourceSessionId,
    params.targetSessionId,
    params.relationType,
    params.confidence,
    params.evidence
  );
}

export function getCorrelationsForSession(sessionId: string): KairosCorrelation[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM kairos_correlations
    WHERE source_session_id = ? OR target_session_id = ?
    ORDER BY created_at DESC
  `).all(sessionId, sessionId) as KairosCorrelation[];

  return rows;
}

export function getCorrelationChain(sessionId: string): KairosCorrelation[] {
  const d = getDb();

  // Recursive CTE to follow the chain from source through all targets
  const rows = d.prepare(`
    WITH RECURSIVE chain AS (
      -- Base case: direct correlations from this session
      SELECT * FROM kairos_correlations
      WHERE source_session_id = ?

      UNION

      -- Recursive case: follow targets as new sources
      SELECT c.*
      FROM kairos_correlations c
      INNER JOIN chain ON c.source_session_id = chain.target_session_id
    )
    SELECT DISTINCT * FROM chain
    ORDER BY created_at
  `).all(sessionId) as KairosCorrelation[];

  return rows;
}

// Prompt change functions
export function recordPromptChange(params: {
  filePath: string;
  changeType: string;
  diffBefore: string;
  diffAfter: string;
  evidenceSessionIds: string[];
  reasoning: string;
}): number {
  const d = getDb();
  const result = d.prepare(`
    INSERT INTO kairos_prompt_changes (
      file_path,
      change_type,
      diff_before,
      diff_after,
      evidence_session_ids,
      reasoning,
      applied
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    params.filePath,
    params.changeType,
    params.diffBefore,
    params.diffAfter,
    JSON.stringify(params.evidenceSessionIds),
    params.reasoning
  );

  return Number(result.lastInsertRowid);
}

export function markPromptChangeRolledBack(changeId: number, reason: string): void {
  const d = getDb();
  d.prepare(`
    UPDATE kairos_prompt_changes
    SET applied = 0, rolled_back_at = datetime('now', 'localtime'), rollback_reason = ?
    WHERE id = ?
  `).run(reason, changeId);
}

export function getPromptChangeHistory(filePath?: string, limit?: number): KairosPromptChange[] {
  const d = getDb();
  const whereClause = filePath ? "WHERE file_path = ?" : "";
  const limitClause = limit ? `LIMIT ${limit}` : "";
  const params = filePath ? [filePath] : [];

  const rows = d.prepare(`
    SELECT * FROM kairos_prompt_changes
    ${whereClause}
    ORDER BY created_at DESC
    ${limitClause}
  `).all(...params) as KairosPromptChange[];

  return rows;
}

export function getActivePromptChanges(): KairosPromptChange[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM kairos_prompt_changes
    WHERE applied = 1 AND rolled_back_at IS NULL
    ORDER BY created_at DESC
  `).all() as KairosPromptChange[];

  return rows;
}
