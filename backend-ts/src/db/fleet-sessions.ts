import { getDb } from "./connection.js";
import type { FleetSessionInfo } from "../fleet-monitor.js";

export function getNextSessionNumber(): number {
  const d = getDb();
  const result = d.prepare(`
    SELECT MAX(session_number) as max_num FROM fleet_sessions
  `).get() as { max_num: number | null } | undefined;

  return (result?.max_num ?? 0) + 1;
}

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
      stuck_detected_at,
      description,
      session_number,
      workflow_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    info.stuckDetectedAt ?? null,
    info.description ?? null,
    info.sessionNumber ?? null,
    info.workflowName ?? null
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
    description: string | null;
    session_number: number | null;
    workflow_name: string | null;
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
    description: row.description ?? undefined,
    sessionNumber: row.session_number ?? undefined,
    workflowName: row.workflow_name ?? undefined,
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
    description: string | null;
    session_number: number | null;
    workflow_name: string | null;
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
    description: row.description ?? undefined,
    sessionNumber: row.session_number ?? undefined,
    workflowName: row.workflow_name ?? undefined,
  };
}

export interface FleetSessionFilters {
  status?: string[];
  workspace?: string;
  workflowName?: string;
  page?: number;
  limit?: number;
}

export interface FleetSessionPage {
  sessions: FleetSessionInfo[];
  total: number;
  page: number;
  limit: number;
}

type DbRow = {
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
  description: string | null;
  session_number: number | null;
  workflow_name: string | null;
};

function rowToFleetSessionInfo(row: DbRow): FleetSessionInfo {
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
    description: row.description ?? undefined,
    sessionNumber: row.session_number ?? undefined,
    workflowName: row.workflow_name ?? undefined,
  };
}

export function getFilteredFleetSessions(filters: FleetSessionFilters): FleetSessionPage {
  const d = getDb();
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  // Filter by status (array, OR condition)
  if (filters.status && filters.status.length > 0) {
    const placeholders = filters.status.map(() => '?').join(',');
    whereClauses.push(`status IN (${placeholders})`);
    params.push(...filters.status);
  }

  // Filter by workspace (partial match)
  if (filters.workspace?.trim()) {
    whereClauses.push('workspace LIKE ?');
    params.push(`%${filters.workspace.trim()}%`);
  }

  // Filter by workflow name (exact match)
  if (filters.workflowName?.trim()) {
    whereClauses.push('workflow_name = ?');
    params.push(filters.workflowName.trim());
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countSql = `SELECT COUNT(*) as total FROM fleet_sessions ${whereClause}`;
  const countResult = d.prepare(countSql).get(...params) as { total: number };
  const total = countResult.total;

  // Get paginated results
  const dataSql = `
    SELECT * FROM fleet_sessions
    ${whereClause}
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `;
  const rows = d.prepare(dataSql).all(...params, limit, offset) as DbRow[];

  const sessions = rows.map(rowToFleetSessionInfo);

  return {
    sessions,
    total,
    page,
    limit,
  };
}

export interface FleetFilterValues {
  statuses: string[];
  workspaces: string[];
  workflowNames: string[];
}

export function getFleetFilterValues(): FleetFilterValues {
  const d = getDb();

  // Get distinct statuses
  const statusRows = d.prepare(`
    SELECT DISTINCT status FROM fleet_sessions
    WHERE status IS NOT NULL
    ORDER BY status
  `).all() as Array<{ status: string }>;

  // Get distinct workspaces
  const workspaceRows = d.prepare(`
    SELECT DISTINCT workspace FROM fleet_sessions
    WHERE workspace IS NOT NULL
    ORDER BY workspace
  `).all() as Array<{ workspace: string }>;

  // Get distinct workflow names
  const workflowRows = d.prepare(`
    SELECT DISTINCT workflow_name FROM fleet_sessions
    WHERE workflow_name IS NOT NULL
    ORDER BY workflow_name
  `).all() as Array<{ workflow_name: string }>;

  return {
    statuses: statusRows.map(r => r.status),
    workspaces: workspaceRows.map(r => r.workspace),
    workflowNames: workflowRows.map(r => r.workflow_name),
  };
}
