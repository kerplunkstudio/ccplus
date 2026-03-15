import React, { useState, useEffect } from 'react';
import './InsightsPanel.css';

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
  };
  daily: DailyData[];
  by_project: ProjectData[];
  by_tool: ToolData[];
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
        <div className="insights-loading">Loading insights...</div>
      </div>
    );
  }

  if (error || !insights) {
    return (
      <div className="insights-panel">
        <div className="insights-error">{error || 'Failed to load insights'}</div>
      </div>
    );
  }

  const maxQueries = Math.max(...insights.daily.map(d => d.queries), 1);
  const maxToolCalls = Math.max(...insights.daily.map(d => d.tool_calls), 1);
  const chartMax = Math.max(maxQueries, maxToolCalls);

  // Determine x-axis label frequency based on days
  const labelFrequency = selectedDays <= 14 ? 2 : selectedDays <= 30 ? 5 : 10;

  return (
    <div className="insights-panel">
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

      {/* Hero metric */}
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

      {/* Inline stats row */}
      <div className="insights-stats-row">
        <span className="insights-stat-item">
          ▸ {formatNumber(insights.summary.total_input_tokens + insights.summary.total_output_tokens)} tokens
        </span>
        <span className="insights-stat-item">
          ▸ {formatNumber(insights.summary.total_tool_calls)} tool calls
        </span>
        <span className="insights-stat-item">
          ▸ {insights.summary.total_sessions} sessions
        </span>
        <span className="insights-stat-item">
          ▸ {formatCost(insights.summary.total_cost)} est. cost
        </span>
      </div>

      <div className="insights-divider" />

      {/* Daily bar chart */}
      <div className="insights-chart-section">
        <div className="insights-chart">
          <div className="insights-chart-y-axis">
            <span className="insights-y-label">{formatNumber(chartMax)}</span>
            <span className="insights-y-label">{formatNumber(Math.floor(chartMax * 0.75))}</span>
            <span className="insights-y-label">{formatNumber(Math.floor(chartMax * 0.5))}</span>
            <span className="insights-y-label">{formatNumber(Math.floor(chartMax * 0.25))}</span>
            <span className="insights-y-label">0</span>
          </div>
          <div className="insights-chart-bars">
            {insights.daily.map((day, idx) => {
              const queryHeight = Math.max((day.queries / chartMax) * 100, 0.5);
              const toolHeight = Math.max((day.tool_calls / chartMax) * 100, 0.5);
              // Parse as local date (noon) to avoid UTC-to-local day shift
              const localDate = new Date(day.date + 'T12:00:00');
              const tooltipLabel = localDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

              return (
                <div key={day.date} className="insights-bar-wrapper">
                  <div className="insights-bar-group">
                    <div
                      className="insights-bar insights-bar-secondary"
                      style={{ height: `${toolHeight}%` }}
                      data-tooltip={`${tooltipLabel} · ${day.queries} queries · ${day.tool_calls} tool calls · ${day.sessions} sessions`}
                    />
                    <div
                      className="insights-bar insights-bar-primary"
                      style={{ height: `${queryHeight}%` }}
                      data-tooltip={`${tooltipLabel} · ${day.queries} queries · ${day.tool_calls} tool calls · ${day.sessions} sessions`}
                    />
                  </div>
                  {idx % labelFrequency === 0 && (
                    <div className="insights-bar-label">
                      {localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom columns */}
      <div className="insights-columns">
        {/* Top projects */}
        <div className="insights-column">
          <div className="insights-section-label">TOP PROJECTS</div>
          {insights.by_project.length > 0 ? (
            <div className="insights-list">
              {insights.by_project.slice(0, 5).map((proj) => (
                <div key={proj.path} className="insights-list-item">
                  <div className="insights-list-item-row">
                    <span className="insights-list-item-label" title={proj.path}>{proj.project}</span>
                    <span className="insights-list-leader" />
                    <span className="insights-list-item-value">{formatNumber(proj.queries)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="insights-empty">No project data</div>
          )}
        </div>

        {/* Top tools */}
        <div className="insights-column">
          <div className="insights-section-label">TOP TOOLS</div>
          {insights.by_tool.length > 0 ? (
            <div className="insights-list">
              {insights.by_tool.slice(0, 5).map((tool) => (
                <div key={tool.tool} className="insights-list-item">
                  <div className="insights-list-item-row">
                    <span className="insights-list-item-label">{tool.tool}</span>
                    <span className="insights-list-leader" />
                    <span className="insights-list-item-value">{formatNumber(tool.count)}</span>
                    <span className={`insights-success-badge ${tool.success_rate >= 0.9 ? 'high' : tool.success_rate >= 0.7 ? 'medium' : 'low'}`}>
                      {(tool.success_rate * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="insights-empty">No tool data</div>
          )}
        </div>
      </div>
    </div>
  );
};
