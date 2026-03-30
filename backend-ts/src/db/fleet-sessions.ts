import { getDb } from "./connection.js";
import type { FleetSessionInfo } from "../fleet-monitor.js";

export function upsertFleetSession(info: FleetSessionInfo): void {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO fleet_sessions (
      session_id,
      status,
      workspace,
      tool_count,
      active_agents,
      total_agents,
      input_tokens,
      output_tokens,
      duration_ms,
      started_at,
      last_activity,
      label,
      files_touched,
      requested_by_source,
      requested_by_source_id,
      stuck_detected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    info.sessionId,
    info.status,
    info.workspace,
    info.toolCount,
    info.activeAgents,
    info.totalAgents,
    info.inputTokens,
    info.outputTokens,
    info.durationMs,
    info.startedAt,
    info.lastActivity,
    info.label,
    JSON.stringify(info.filesTouched),
    info.requestedBy?.source ?? null,
    info.requestedBy?.sourceId ?? null,
    info.stuckDetectedAt ?? null
  );
}

export function getAllFleetSessions(limit = 500): FleetSessionInfo[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM fleet_sessions
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    session_id: string;
    status: string;
    workspace: string;
    tool_count: number;
    active_agents: number;
    total_agents: number;
    input_tokens: number;
    output_tokens: number;
    duration_ms: number;
    started_at: string;
    last_activity: string;
    label: string;
    files_touched: string;
    requested_by_source: string | null;
    requested_by_source_id: string | null;
    stuck_detected_at: number | null;
  }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    status: row.status as FleetSessionInfo['status'],
    workspace: row.workspace,
    toolCount: row.tool_count,
    activeAgents: row.active_agents,
    totalAgents: row.total_agents,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    label: row.label,
    filesTouched: JSON.parse(row.files_touched) as string[],
    requestedBy: row.requested_by_source && row.requested_by_source_id
      ? { source: row.requested_by_source, sourceId: row.requested_by_source_id }
      : undefined,
    stuckDetectedAt: row.stuck_detected_at ?? undefined,
  }));
}

export function getFleetSession(sessionId: string): FleetSessionInfo | null {
  const d = getDb();
  const row = d.prepare(`
    SELECT * FROM fleet_sessions
    WHERE session_id = ?
  `).get(sessionId) as {
    session_id: string;
    status: string;
    workspace: string;
    tool_count: number;
    active_agents: number;
    total_agents: number;
    input_tokens: number;
    output_tokens: number;
    duration_ms: number;
    started_at: string;
    last_activity: string;
    label: string;
    files_touched: string;
    requested_by_source: string | null;
    requested_by_source_id: string | null;
    stuck_detected_at: number | null;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    status: row.status as FleetSessionInfo['status'],
    workspace: row.workspace,
    toolCount: row.tool_count,
    activeAgents: row.active_agents,
    totalAgents: row.total_agents,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    label: row.label,
    filesTouched: JSON.parse(row.files_touched) as string[],
    requestedBy: row.requested_by_source && row.requested_by_source_id
      ? { source: row.requested_by_source, sourceId: row.requested_by_source_id }
      : undefined,
    stuckDetectedAt: row.stuck_detected_at ?? undefined,
  };
}
