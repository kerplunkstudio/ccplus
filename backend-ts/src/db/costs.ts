import { getDb } from "./connection.js";

export interface CostDashboardResponse {
  hero: {
    today: number;
    this_week: number;
    this_month: number;
  };
  top_sessions: Array<{
    session_id: string;
    label: string;
    total_cost: number;
    input_tokens: number;
    output_tokens: number;
    query_count: number;
  }>;
  by_model: Array<{
    model: string;
    queries: number;
    total_cost: number;
    input_tokens: number;
    output_tokens: number;
  }>;
  daily_trend: Array<{
    date: string;
    cost: number;
    input_tokens: number;
    output_tokens: number;
  }>;
}

export function getCostDashboard(): CostDashboardResponse {
  const d = getDb();

  // Hero metrics
  const todayRow = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost
    FROM query_usage
    WHERE date(timestamp) = date('now', 'localtime')
  `).get() as { cost: number };

  // ISO week: Monday = day 1. Subtract (weekday % 7) days to get Monday.
  // SQLite: (strftime('%w', ...) + 6) % 7 gives 0=Mon, 1=Tue, ..., 6=Sun
  const thisWeekRow = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost
    FROM query_usage
    WHERE date(timestamp) >= date('now', 'localtime', '-' || ((strftime('%w', 'now', 'localtime') + 6) % 7) || ' days')
    AND date(timestamp) <= date('now', 'localtime')
  `).get() as { cost: number };

  const thisMonthRow = d.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost
    FROM query_usage
    WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now', 'localtime')
  `).get() as { cost: number };

  // Top 10 sessions (last 30 days)
  const topSessionsRows = d.prepare(`
    SELECT
      q.session_id,
      COALESCE(SUM(q.cost_usd), 0) as total_cost,
      COALESCE(SUM(q.input_tokens), 0) as input_tokens,
      COALESCE(SUM(q.output_tokens), 0) as output_tokens,
      COUNT(*) as query_count,
      (SELECT content FROM conversations c
       WHERE c.session_id = q.session_id AND c.role = 'user'
       ORDER BY c.timestamp ASC LIMIT 1) as label
    FROM query_usage q
    WHERE date(q.timestamp) >= date('now', 'localtime', '-30 days')
    GROUP BY q.session_id
    ORDER BY total_cost DESC
    LIMIT 10
  `).all() as Array<{
    session_id: string;
    total_cost: number;
    input_tokens: number;
    output_tokens: number;
    query_count: number;
    label: string | null;
  }>;

  const topSessions = topSessionsRows.map((row) => {
    const sessionLabel = row.label
      ? (row.label.length > 50 ? row.label.slice(0, 50) + "..." : row.label)
      : "Untitled session";
    return {
      session_id: row.session_id,
      label: sessionLabel,
      total_cost: row.total_cost || 0,
      input_tokens: row.input_tokens || 0,
      output_tokens: row.output_tokens || 0,
      query_count: row.query_count || 0,
    };
  });

  // By model (last 30 days, exclude null/empty/unknown)
  const byModelRows = d.prepare(`
    SELECT
      model,
      COUNT(*) as queries,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM query_usage
    WHERE date(timestamp) >= date('now', 'localtime', '-30 days')
    AND model IS NOT NULL AND model != '' AND model != 'unknown' AND model NOT LIKE '<%>'
    GROUP BY model
    ORDER BY total_cost DESC
  `).all() as Array<{
    model: string;
    queries: number;
    total_cost: number;
    input_tokens: number;
    output_tokens: number;
  }>;

  const byModel = byModelRows.map((row) => ({
    model: row.model,
    queries: row.queries || 0,
    total_cost: row.total_cost || 0,
    input_tokens: row.input_tokens || 0,
    output_tokens: row.output_tokens || 0,
  }));

  // Daily trend (last 14 days)
  const dailyTrendRows = d.prepare(`
    SELECT
      date(timestamp) as date,
      COALESCE(SUM(cost_usd), 0) as cost,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM query_usage
    WHERE date(timestamp) >= date('now', 'localtime', '-14 days')
    GROUP BY date(timestamp)
    ORDER BY date(timestamp) ASC
  `).all() as Array<{
    date: string;
    cost: number;
    input_tokens: number;
    output_tokens: number;
  }>;

  const dailyTrend = dailyTrendRows.map((row) => ({
    date: row.date,
    cost: row.cost || 0,
    input_tokens: row.input_tokens || 0,
    output_tokens: row.output_tokens || 0,
  }));

  return {
    hero: {
      today: todayRow.cost || 0,
      this_week: thisWeekRow.cost || 0,
      this_month: thisMonthRow.cost || 0,
    },
    top_sessions: topSessions,
    by_model: byModel,
    daily_trend: dailyTrend,
  };
}
