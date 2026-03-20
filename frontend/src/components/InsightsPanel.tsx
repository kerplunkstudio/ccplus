import React, { useState, useEffect } from 'react';
import './InsightsPanel.css';
import { InsightsTokenSections } from './InsightsTokenSections';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface InsightsPanelProps {
  projectPath?: string;
  onClose?: () => void;
}

interface DailyData {
  date: string;
  queries: number;
  tool_calls: number;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  sessions: number;
}

interface ProjectData {
  project: string;
  path: string;
  queries: number;
  cost: number;
}

interface ToolData {
  tool: string;
  count: number;
  success_rate: number;
  avg_duration_ms?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  error_count?: number;
}

interface ErrorCategoryData {
  category: string;
  count: number;
}

interface AgentTypeData {
  agent_type: string;
  count: number;
  success_rate: number;
  avg_duration_ms: number;
}

interface HourlyData {
  hour: number;
  queries: number;
}

interface InsightsData {
  period: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    total_queries: number;
    total_cost: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tool_calls: number;
    total_sessions: number;
    change_pct: number;
    avg_cost_per_query?: number;
    avg_tokens_per_query?: number;
    avg_queries_per_session?: number;
    total_errors?: number;
  };
  daily: DailyData[];
  by_project: ProjectData[];
  by_tool: ToolData[];
  by_error_category?: ErrorCategoryData[];
  by_agent_type?: AgentTypeData[];
  hourly_activity?: HourlyData[];
}

interface CachedData {
  insights: InsightsData;
  timestamp: number;
}

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatCost = (cost: number): string => {
  return `$${cost.toFixed(2)}`;
};

const formatDuration = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const getCacheKey = (projectPath: string | undefined, days: number): string => {
  const project = projectPath || 'global';
  return `ccplus_insights_${project}_${days}`;
};

const saveToCache = (projectPath: string | undefined, days: number, insights: InsightsData): void => {
  try {
    const cached: CachedData = {
      insights,
      timestamp: Date.now(),
    };
    localStorage.setItem(getCacheKey(projectPath, days), JSON.stringify(cached));
  } catch (err) {
    console.error('Failed to save insights to cache:', err);
  }
};

const loadFromCache = (projectPath: string | undefined, days: number): CachedData | null => {
  try {
    const raw = localStorage.getItem(getCacheKey(projectPath, days));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedData;
    return cached;
  } catch (err) {
    console.error('Failed to load insights from cache:', err);
    return null;
  }
};

const isCacheFresh = (cacheTimestamp: number): boolean => {
  return Date.now() - cacheTimestamp < CACHE_TTL_MS;
};

export const InsightsPanel: React.FC<InsightsPanelProps> = ({ projectPath, onClose }) => {
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(30);
  const [showingStaleData, setShowingStaleData] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);

  useEffect(() => {
    const fetchInsights = async (isBackgroundRefresh: boolean = false) => {
      if (!isBackgroundRefresh) {
        setLoading(true);
        setError(null);
        setShowingStaleData(false);
      }

      try {
        const params = new URLSearchParams({ days: String(selectedDays) });
        if (projectPath) {
          params.append('project', projectPath);
        }

        const url = `${SOCKET_URL}/api/insights?${params}`;
        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();
          setInsights(data);
          setCacheTimestamp(Date.now());
          setShowingStaleData(false);
          setError(null);
          saveToCache(projectPath, selectedDays, data);
        } else {
          const text = await response.text();
          let errorMessage: string;
          try {
            const errorData = JSON.parse(text);
            errorMessage = errorData.error || `HTTP ${response.status}`;
          } catch {
            errorMessage = `HTTP ${response.status}: ${text.substring(0, 100)}`;
          }

          if (!isBackgroundRefresh) {
            const cached = loadFromCache(projectPath, selectedDays);
            if (cached) {
              setInsights(cached.insights);
              setCacheTimestamp(cached.timestamp);
              setShowingStaleData(true);
              setError(null);
            } else {
              setError(errorMessage);
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const errorMessage = `Network error: ${message}`;

        if (!isBackgroundRefresh) {
          const cached = loadFromCache(projectPath, selectedDays);
          if (cached) {
            setInsights(cached.insights);
            setCacheTimestamp(cached.timestamp);
            setShowingStaleData(true);
            setError(null);
          } else {
            setError(errorMessage);
          }
        }
      } finally {
        if (!isBackgroundRefresh) {
          setLoading(false);
        }
      }
    };

    // Try to load from cache immediately
    const cached = loadFromCache(projectPath, selectedDays);
    if (cached) {
      setInsights(cached.insights);
      setCacheTimestamp(cached.timestamp);
      setLoading(false);

      if (!isCacheFresh(cached.timestamp)) {
        setShowingStaleData(true);
      }

      // Fetch fresh data in background
      fetchInsights(true);
    } else {
      fetchInsights(false);
    }
  }, [projectPath, selectedDays]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setShowingStaleData(false);

    const fetchInsights = async () => {
      try {
        const params = new URLSearchParams({ days: String(selectedDays) });
        if (projectPath) {
          params.append('project', projectPath);
        }

        const url = `${SOCKET_URL}/api/insights?${params}`;
        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();
          setInsights(data);
          setCacheTimestamp(Date.now());
          setShowingStaleData(false);
          setError(null);
          saveToCache(projectPath, selectedDays, data);
        } else {
          const text = await response.text();
          try {
            const errorData = JSON.parse(text);
            setError(errorData.error || `HTTP ${response.status}`);
          } catch {
            setError(`HTTP ${response.status}: ${text.substring(0, 100)}`);
          }
          setShowingStaleData(true);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Network error: ${message}`);
        setShowingStaleData(true);
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
  };

  if (loading) {
    return (
      <div className="insights-panel">
        <div className="insights-container">
          <div className="insights-loading">Loading insights...</div>
        </div>
      </div>
    );
  }

  if (error || !insights) {
    return (
      <div className="insights-panel">
        <div className="insights-container">
          <div className="insights-error">{error || 'Failed to load insights'}</div>
        </div>
      </div>
    );
  }

  const maxQueries = Math.max(...insights.daily.map(d => d.queries), 1);
  const maxToolCalls = Math.max(...insights.daily.map(d => d.tool_calls), 1);
  const chartMax = Math.max(maxQueries, maxToolCalls);

  // Computed metrics
  const avgCostPerQuery = insights.summary.avg_cost_per_query ??
    (insights.summary.total_queries > 0 ? insights.summary.total_cost / insights.summary.total_queries : 0);
  const avgTokensPerQuery = insights.summary.avg_tokens_per_query ??
    (insights.summary.total_queries > 0 ? (insights.summary.total_input_tokens + insights.summary.total_output_tokens) / insights.summary.total_queries : 0);
  const avgQueriesPerSession = insights.summary.avg_queries_per_session ??
    (insights.summary.total_sessions > 0 ? insights.summary.total_queries / insights.summary.total_sessions : 0);

  // Token mix percentages
  const totalTokens = insights.summary.total_input_tokens + insights.summary.total_output_tokens;
  const inputPct = totalTokens > 0 ? (insights.summary.total_input_tokens / totalTokens) * 100 : 0;
  const outputPct = totalTokens > 0 ? (insights.summary.total_output_tokens / totalTokens) * 100 : 0;

  // Max cost for area chart scaling
  const maxDailyCost = Math.max(...insights.daily.map(d => d.cost), 0.01);

  // Hourly activity max for heatmap
  const maxHourlyQueries = insights.hourly_activity
    ? Math.max(...insights.hourly_activity.map(h => h.queries), 1)
    : 1;

  return (
    <div className="insights-panel">
      <div className="insights-container">
        {/* Stale data indicator */}
        {showingStaleData && cacheTimestamp && (
          <div className="insights-stale-indicator">
            <span className="insights-stale-text">
              Showing cached data · Last updated {new Date(cacheTimestamp).toLocaleTimeString()}
            </span>
            <button className="insights-stale-retry" onClick={handleRetry}>
              Retry
            </button>
          </div>
        )}

        {/* 1. HEADER */}
        <div className="insights-header">
          <h1 className="insights-title">Insights</h1>
          <select
            className="insights-period-selector"
            value={selectedDays}
            onChange={(e) => setSelectedDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>

        {/* 2. HERO METRICS */}
        <div className="insights-hero">
          <div className="insights-hero-number">
            {formatNumber(insights.summary.total_queries)}
          </div>
          <div className="insights-hero-label">
            queries in the last {selectedDays} days
            {insights.summary.change_pct !== 0 && (
              <span className={`insights-change ${insights.summary.change_pct > 0 ? 'positive' : 'negative'}`}>
                {insights.summary.change_pct > 0 ? '+' : ''}{insights.summary.change_pct}%
              </span>
            )}
          </div>
        </div>

        {/* Hero stats inline row */}
        <div className="insights-hero-stats">
          <span className="insights-hero-stat">{formatNumber(totalTokens)} tokens</span>
          <span className="insights-hero-stat-sep">•</span>
          <span className="insights-hero-stat">{formatNumber(insights.summary.total_tool_calls)} tool calls</span>
          <span className="insights-hero-stat-sep">•</span>
          <span className="insights-hero-stat">{insights.summary.total_sessions} sessions</span>
          <span className="insights-hero-stat-sep">•</span>
          <span className="insights-hero-stat">{formatCost(insights.summary.total_cost)} est. cost</span>
        </div>

        {/* 3. EFFICIENCY ROW */}
        <div className="insights-efficiency">
          <div className="insights-efficiency-item">
            <div className="insights-efficiency-label">Avg cost per query</div>
            <div className="insights-efficiency-value">{formatCost(avgCostPerQuery)}</div>
          </div>
          <div className="insights-efficiency-item">
            <div className="insights-efficiency-label">Avg tokens per query</div>
            <div className="insights-efficiency-value">{formatNumber(avgTokensPerQuery)}</div>
          </div>
          <div className="insights-efficiency-item">
            <div className="insights-efficiency-label">Avg queries per session</div>
            <div className="insights-efficiency-value">{avgQueriesPerSession.toFixed(1)}</div>
          </div>
        </div>

        <div className="insights-divider" />

        {/* 4. DAILY ACTIVITY CHART */}
        <div className="insights-section">
          <div className="insights-section-label">DAILY ACTIVITY</div>
          <div className="insights-chart-legend">
            <span className="insights-legend-item">
              <span className="insights-legend-dot insights-legend-queries" />
              Queries
            </span>
            <span className="insights-legend-item">
              <span className="insights-legend-dot insights-legend-tools" />
              Tool calls
            </span>
          </div>
          <div className="insights-chart">
            <div className="insights-chart-y-axis">
              <span className="insights-y-label">{formatNumber(chartMax)}</span>
              <span className="insights-y-label">{formatNumber(Math.floor(chartMax * 0.75))}</span>
              <span className="insights-y-label">{formatNumber(Math.floor(chartMax * 0.5))}</span>
              <span className="insights-y-label">{formatNumber(Math.floor(chartMax * 0.25))}</span>
              <span className="insights-y-label">0</span>
            </div>
            <div className="insights-chart-bars">
              {insights.daily.map((day) => {
                const queryHeight = Math.max((day.queries / chartMax) * 100, 0.5);
                const toolHeight = Math.max((day.tool_calls / chartMax) * 100, 0.5);
                const localDate = new Date(day.date + 'T12:00:00');
                const tooltipLabel = localDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

                return (
                  <div key={day.date} className="insights-bar-wrapper">
                    <div className="insights-bar-group">
                      <div
                        className="insights-bar insights-bar-secondary"
                        style={{ height: `${toolHeight}%` }}
                        data-tooltip={`${tooltipLabel} · ${day.queries} queries · ${day.tool_calls} tool calls · ${formatCost(day.cost)}`}
                      />
                      <div
                        className="insights-bar insights-bar-primary"
                        style={{ height: `${queryHeight}%` }}
                        data-tooltip={`${tooltipLabel} · ${day.queries} queries · ${day.tool_calls} tool calls · ${formatCost(day.cost)}`}
                      />
                    </div>
                    <div className="insights-bar-label">
                      {localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 5. COST & TOKEN BREAKDOWN */}
        <div className="insights-cost-token-grid">
          {/* Left: Cost trend */}
          <div className="insights-section">
            <div className="insights-section-label">DAILY COST TREND</div>
            <div className="insights-cost-total">{formatCost(insights.summary.total_cost)}</div>
            <div className="insights-cost-chart">
              {insights.daily.map((day) => {
                const height = Math.max((day.cost / maxDailyCost) * 100, 2);
                return (
                  <div
                    key={day.date}
                    className="insights-cost-bar"
                    style={{ height: `${height}%` }}
                    data-tooltip={`${new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${formatCost(day.cost)}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Right: Token mix */}
          <div className="insights-section">
            <div className="insights-section-label">TOKEN MIX</div>
            <div className="insights-token-total">{formatNumber(totalTokens)} tokens</div>
            <div className="insights-token-bar">
              <div className="insights-token-input" style={{ width: `${inputPct}%` }}>
                <span className="insights-token-label">{formatNumber(insights.summary.total_input_tokens)} input</span>
              </div>
              <div className="insights-token-output" style={{ width: `${outputPct}%` }}>
                <span className="insights-token-label">{formatNumber(insights.summary.total_output_tokens)} output</span>
              </div>
            </div>
            <div className="insights-token-ratio">
              Input {inputPct.toFixed(0)}% · Output {outputPct.toFixed(0)}%
            </div>
          </div>
        </div>

        <InsightsTokenSections
          daily={insights.daily}
          selectedDays={selectedDays}
          rateLimitEvents={insights.rate_limit_events}
          totalRateLimits={insights.summary.total_rate_limits}
          cacheReadTokens={insights.summary.cache_read_input_tokens}
          cacheCreationTokens={insights.summary.cache_creation_input_tokens}
          cacheHitRate={insights.summary.cache_hit_rate}
          sessionData={insights.by_session}
        />

        <div className="insights-divider" />

        {/* 6. TOOL PERFORMANCE TABLE */}
        <div className="insights-section">
          <div className="insights-section-label">TOOL PERFORMANCE</div>
          {insights.by_tool.length > 0 ? (
            <div className="insights-table">
              <div className="insights-table-header">
                <div className="insights-table-cell insights-table-cell-tool">Tool</div>
                <div className="insights-table-cell insights-table-cell-invocations">Invocations</div>
                <div className="insights-table-cell insights-table-cell-success">Success Rate</div>
                <div className="insights-table-cell insights-table-cell-duration">Avg Duration</div>
                <div className="insights-table-cell insights-table-cell-errors">Errors</div>
              </div>
              {insights.by_tool.map((tool) => (
                <div key={tool.tool} className="insights-table-row">
                  <div className="insights-table-cell insights-table-cell-tool">{tool.tool}</div>
                  <div className="insights-table-cell insights-table-cell-invocations">{formatNumber(tool.count)}</div>
                  <div className="insights-table-cell insights-table-cell-success">
                    <div className="insights-success-bar-wrapper">
                      <div className="insights-success-bar" style={{ width: `${tool.success_rate * 100}%` }} />
                      <span className="insights-success-pct">{(tool.success_rate * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="insights-table-cell insights-table-cell-duration">
                    {tool.avg_duration_ms ? formatDuration(tool.avg_duration_ms) : '—'}
                  </div>
                  <div className="insights-table-cell insights-table-cell-errors">
                    {tool.error_count ? (
                      <span className="insights-error-count">{tool.error_count}</span>
                    ) : '—'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="insights-empty">No tool data</div>
          )}
        </div>

        <div className="insights-divider" />

        {/* 7. PROJECTS */}
        <div className="insights-section">
          <div className="insights-section-label">PROJECTS</div>
          {insights.by_project.length > 0 ? (
            <div className="insights-projects-list">
              {insights.by_project.map((proj) => (
                <div key={proj.path} className="insights-project-row">
                  <span className="insights-project-name" title={proj.path}>{proj.project}</span>
                  <span className="insights-project-leader" />
                  <span className="insights-project-queries">{formatNumber(proj.queries)}</span>
                  <span className="insights-project-cost">{formatCost(proj.cost)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="insights-empty">No project data</div>
          )}
        </div>

        {/* 8. HOURLY ACTIVITY HEATMAP */}
        {insights.hourly_activity && insights.hourly_activity.length > 0 && (
          <>
            <div className="insights-divider" />
            <div className="insights-section">
              <div className="insights-section-label">HOURLY ACTIVITY</div>
              <div className="insights-heatmap">
                {Array.from({ length: 24 }).map((_, hour) => {
                  const data = insights.hourly_activity!.find(h => h.hour === hour);
                  const queries = data?.queries ?? 0;
                  const opacity = queries > 0 ? Math.max(0.15, queries / maxHourlyQueries) : 0.05;
                  return (
                    <div
                      key={hour}
                      className="insights-heatmap-cell"
                      style={{ opacity }}
                      data-tooltip={`${hour}:00 · ${queries} queries`}
                    >
                      {hour % 6 === 0 && <span className="insights-heatmap-label">{hour}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* 9. AGENT TYPES */}
        {insights.by_agent_type && insights.by_agent_type.length > 0 && (
          <>
            <div className="insights-divider" />
            <div className="insights-section">
              <div className="insights-section-label">AGENT TYPES</div>
              <div className="insights-agent-list">
                {insights.by_agent_type.map((agent) => (
                  <div key={agent.agent_type} className="insights-agent-row">
                    <span className="insights-agent-type">{agent.agent_type}</span>
                    <span className="insights-agent-leader" />
                    <span className="insights-agent-count">{formatNumber(agent.count)}</span>
                    <span className={`insights-agent-success ${agent.success_rate >= 0.9 ? 'high' : agent.success_rate >= 0.7 ? 'medium' : 'low'}`}>
                      {(agent.success_rate * 100).toFixed(0)}%
                    </span>
                    <span className="insights-agent-duration">{formatDuration(agent.avg_duration_ms)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 10. ERROR ANALYSIS */}
        {insights.by_error_category && insights.by_error_category.length > 0 && (
          <>
            <div className="insights-divider" />
            <div className="insights-section">
              <div className="insights-section-label">ERROR ANALYSIS</div>
              <div className="insights-error-list">
                {insights.by_error_category
                  .sort((a, b) => b.count - a.count)
                  .map((err) => {
                    const maxErrors = Math.max(...insights.by_error_category!.map(e => e.count));
                    const barWidth = (err.count / maxErrors) * 100;
                    return (
                      <div key={err.category} className="insights-error-row">
                        <div className="insights-error-category">{err.category}</div>
                        <div className="insights-error-bar-wrapper">
                          <div className="insights-error-bar" style={{ width: `${barWidth}%` }} />
                        </div>
                        <div className="insights-error-count-label">{err.count}</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>
        )}

        {/* 11. FOOTER */}
        <div className="insights-footer">
          {formatDate(insights.period.start)} – {formatDate(insights.period.end)}
        </div>
      </div>
    </div>
  );
};
