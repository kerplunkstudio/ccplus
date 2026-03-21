import path from "path";
import { getDb } from "./connection.js";

export function getInsights(days: number = 30, projectPath?: string, source?: string): Record<string, unknown> {
  const d = getDb();

  const endDate = (d.prepare("SELECT date('now', 'localtime') as d").get() as { d: string }).d;
  const startDate = (d.prepare("SELECT date('now', 'localtime', ?) as d").get(`-${days} days`) as { d: string }).d;
  const prevStart = (d.prepare("SELECT date('now', 'localtime', ?) as d").get(`-${days * 2} days`) as { d: string }).d;
  const prevEnd = (d.prepare("SELECT date('now', 'localtime', ?) as d").get(`-${days + 1} days`) as { d: string }).d;

  // Build project and source filters
  const convSourceFilter = (source && source !== 'all') ? "AND source = ?" : "";
  const convSourceParams = (source && source !== 'all') ? [source] : [];
  const convProjectFilter = projectPath ? "AND project_path = ?" : "";
  const convProjectParams = projectPath ? [projectPath] : [];
  const convFilters = `${convProjectFilter} ${convSourceFilter}`;
  const convParams = [...convProjectParams, ...convSourceParams];

  const toolProjectFilter = projectPath
    ? `AND session_id IN (
        SELECT DISTINCT session_id FROM conversations
        WHERE project_path = ? AND (archived = 0 OR archived IS NULL) ${convSourceFilter}
      )`
    : "";
  const toolProjectParams = projectPath ? [projectPath, ...convSourceParams] : [];
  const toolSourceFilter = (source && source !== 'all' && !projectPath)
    ? `AND session_id IN (
        SELECT DISTINCT session_id FROM conversations
        WHERE source = ? AND (archived = 0 OR archived IS NULL)
      )`
    : "";
  const toolSourceParams = (source && source !== 'all' && !projectPath) ? [source] : [];
  const toolFilters = `${toolProjectFilter}${toolSourceFilter}`;
  const toolParams = [...toolProjectParams, ...toolSourceParams];

  const querySourceFilter = (source && source !== 'all') ? "AND source = ?" : "";
  const querySourceParams = (source && source !== 'all') ? [source] : [];
  const queryProjectFilter = projectPath ? "AND project_path = ?" : "";
  const queryProjectParams = projectPath ? [projectPath] : [];
  const queryFilters = `${queryProjectFilter} ${querySourceFilter}`;
  const queryParams = [...queryProjectParams, ...querySourceParams];

  // Conversation summary
  const convSummary = d.prepare(`
    SELECT
      COUNT(DISTINCT session_id) as total_sessions,
      COUNT(CASE WHEN role = 'user' THEN 1 END) as total_queries
    FROM conversations
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND (archived = 0 OR archived IS NULL)
    ${convFilters}
  `).get(startDate, endDate, ...convParams) as { total_sessions: number; total_queries: number };

  // Tool summary
  const toolSummary = d.prepare(`
    SELECT
      COUNT(*) as total_tool_calls
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    ${toolFilters}
  `).get(startDate, endDate, ...toolParams) as { total_tool_calls: number };

  // Token summary from query_usage
  const tokenSummary = d.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(cache_read_input_tokens), 0) as total_cache_read,
      COALESCE(SUM(cache_creation_input_tokens), 0) as total_cache_creation,
      COALESCE(SUM(cost_usd), 0) as total_cost
    FROM query_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    ${queryFilters}
  `).get(startDate, endDate, ...queryParams) as {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_read: number;
    total_cache_creation: number;
    total_cost: number;
  };

  // Previous period
  const prevSummary = d.prepare(`
    SELECT COUNT(CASE WHEN role = 'user' THEN 1 END) as prev_queries
    FROM conversations
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND (archived = 0 OR archived IS NULL)
    ${convFilters}
  `).get(prevStart, prevEnd, ...convParams) as { prev_queries: number };

  const inputTokens = tokenSummary.total_input_tokens || 0;
  const outputTokens = tokenSummary.total_output_tokens || 0;
  const totalCost = tokenSummary.total_cost || 0;

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
    ${convFilters}
    GROUP BY date(timestamp)
    ORDER BY date(timestamp) ASC
  `).all(startDate, endDate, ...convParams) as { date: string; queries: number; sessions: number }[];

  // Daily breakdown - tools
  const dailyToolRows = d.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(*) as tool_calls
    FROM tool_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    ${toolFilters}
    GROUP BY date(timestamp)
    ORDER BY date(timestamp) ASC
  `).all(startDate, endDate, ...toolParams) as { date: string; tool_calls: number }[];

  // Daily breakdown - token usage from query_usage
  const dailyTokenRows = d.prepare(`
    SELECT
      date(timestamp) as date,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM query_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    ${queryFilters}
    GROUP BY date(timestamp)
    ORDER BY date(timestamp) ASC
  `).all(startDate, endDate, ...queryParams) as { date: string; input_tokens: number; output_tokens: number; cost_usd: number }[];

  // Merge daily data
  const convByDate = new Map(dailyConvRows.map((r) => [r.date, r]));
  const toolByDate = new Map(dailyToolRows.map((r) => [r.date, r]));
  const tokenByDate = new Map(dailyTokenRows.map((r) => [r.date, r]));
  const allDates = [...new Set([...convByDate.keys(), ...toolByDate.keys(), ...tokenByDate.keys()])].sort();

  const daily = allDates.map((date) => {
    const c = convByDate.get(date);
    const t = toolByDate.get(date);
    const tk = tokenByDate.get(date);
    const dayInput = tk?.input_tokens || 0;
    const dayOutput = tk?.output_tokens || 0;
    const dayCost = tk?.cost_usd || 0;
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
    ${convFilters}
    GROUP BY project_path
    ORDER BY queries DESC
  `).all(startDate, endDate, ...convParams) as { project_path: string; queries: number; sessions: number }[];

  const byProject = byProjectRows.map((row) => {
    const projectName = row.project_path ? path.basename(row.project_path) : "Unknown";
    const projTokens = d.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM query_usage
      WHERE date(timestamp) >= ? AND date(timestamp) <= ?
      AND project_path = ?
      ${querySourceFilter}
    `).get(startDate, endDate, row.project_path, ...querySourceParams) as { input_tokens: number; output_tokens: number; cost_usd: number };

    const projCost = projTokens.cost_usd || 0;

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
    ${toolFilters}
    GROUP BY tool_name
    ORDER BY count DESC
  `).all(startDate, endDate, ...toolParams) as {
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
    ${toolFilters}
    GROUP BY error_category
    ORDER BY count DESC
  `).all(startDate, endDate, ...toolParams) as { error_category: string; count: number }[];

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
    ${toolFilters}
    GROUP BY agent_type
    ORDER BY count DESC
  `).all(startDate, endDate, ...toolParams) as {
    agent_type: string;
    count: number;
    success_count: number;
    avg_duration_ms: number;
  }[];

  const byAgentType = byAgentTypeRows.map((row) => ({
    agent_type: row.agent_type,
    count: row.count,
    success_rate: row.count > 0 ? row.success_count / row.count : 0,
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
    ${convFilters}
    GROUP BY hour
    ORDER BY hour ASC
  `).all(startDate, endDate, ...convParams) as { hour: number; queries: number }[];

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
    ${toolFilters}
  `).get(startDate, endDate, ...toolParams) as { count: number };

  const avgCostPerQuery = currentQueries > 0 ? Math.round((totalCost / currentQueries) * 100) / 100 : 0;
  const avgTokensPerQuery = currentQueries > 0
    ? Math.round(((inputTokens + outputTokens) / currentQueries) * 100) / 100
    : 0;
  const avgQueriesPerSession = convSummary.total_sessions > 0
    ? Math.round((currentQueries / convSummary.total_sessions) * 100) / 100
    : 0;

  // Rate limit events
  const rateLimitRows = d.prepare(`
    SELECT timestamp, session_id, retry_after_ms
    FROM rate_limit_events
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    ORDER BY timestamp DESC
    LIMIT 50
  `).all(startDate, endDate) as Array<{ timestamp: string; session_id: string; retry_after_ms: number }>;

  const rateLimitCount = d.prepare(`
    SELECT COUNT(*) as total
    FROM rate_limit_events
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
  `).get(startDate, endDate) as { total: number };

  // Cache efficiency (use tokenSummary values already fetched)
  // cache_read = tokens served from cache, cache_creation = tokens written to cache (miss),
  // input_tokens = new non-cached input. Hit rate = reads / total context tokens.
  const totalCacheRead = tokenSummary.total_cache_read || 0;
  const totalCacheCreation = tokenSummary.total_cache_creation || 0;
  const totalContextTokens = totalCacheRead + totalCacheCreation + inputTokens;
  const cacheHitRate = totalContextTokens > 0
    ? Math.round((totalCacheRead / totalContextTokens) * 10000) / 100
    : 0;

  // Per-session token breakdown
  const bySessionRows = d.prepare(`
    SELECT
      q.session_id,
      COALESCE(SUM(q.input_tokens), 0) as input_tokens,
      COALESCE(SUM(q.output_tokens), 0) as output_tokens,
      COALESCE(SUM(q.cache_read_input_tokens), 0) as cache_read_tokens,
      (SELECT content FROM conversations c2
       WHERE c2.session_id = q.session_id AND c2.role = 'user'
       ORDER BY c2.timestamp ASC LIMIT 1) as label
    FROM query_usage q
    WHERE date(q.timestamp) >= ? AND date(q.timestamp) <= ?
    ${queryFilters}
    GROUP BY q.session_id
    ORDER BY (SUM(q.input_tokens) + SUM(q.output_tokens)) DESC
    LIMIT 20
  `).all(startDate, endDate, ...queryParams) as Array<{
    session_id: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    label: string | null;
  }>;

  const bySession = bySessionRows.map((row) => {
    const sessionLabel = row.label
      ? (row.label.length > 50 ? row.label.slice(0, 50) + "..." : row.label)
      : "Untitled session";
    // Get tool count for this session
    const toolCountRow = d.prepare(`
      SELECT COUNT(DISTINCT tool_name) as tool_count
      FROM tool_usage
      WHERE session_id = ?
      AND date(timestamp) >= ? AND date(timestamp) <= ?
    `).get(row.session_id, startDate, endDate) as { tool_count: number };
    return {
      session_id: row.session_id,
      label: sessionLabel,
      input_tokens: row.input_tokens || 0,
      output_tokens: row.output_tokens || 0,
      cache_read_tokens: row.cache_read_tokens || 0,
      tool_count: toolCountRow.tool_count || 0,
    };
  });

  // By model
  const byModelRows = d.prepare(`
    SELECT
      model,
      COUNT(*) as queries,
      SUM(cost_usd) as total_cost,
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output,
      SUM(cache_read_input_tokens) as total_cache_read,
      SUM(cache_creation_input_tokens) as total_cache_creation
    FROM query_usage
    WHERE date(timestamp) >= ? AND date(timestamp) <= ?
    AND model IS NOT NULL AND model != '' AND model != 'unknown' AND model NOT LIKE '<%>'
    ${queryFilters}
    GROUP BY model
    ORDER BY total_cost DESC
  `).all(startDate, endDate, ...queryParams) as Array<{
    model: string;
    queries: number;
    total_cost: number;
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_cache_creation: number;
  }>;

  const byModel = byModelRows.map((row) => ({
    model: row.model,
    queries: row.queries || 0,
    total_cost: Math.round((row.total_cost || 0) * 100) / 100,
    total_input: row.total_input || 0,
    total_output: row.total_output || 0,
    total_cache_read: row.total_cache_read || 0,
    total_cache_creation: row.total_cache_creation || 0,
  }));

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
      total_rate_limits: rateLimitCount.total || 0,
      cache_read_input_tokens: totalCacheRead,
      cache_creation_input_tokens: totalCacheCreation,
      cache_hit_rate: cacheHitRate,
    },
    daily,
    by_project: byProject,
    by_tool: byTool,
    by_error_category: byErrorCategory,
    by_agent_type: byAgentType,
    hourly_activity: hourlyActivity,
    rate_limit_events: rateLimitRows,
    by_session: bySession,
    by_model: byModel,
  };
}
