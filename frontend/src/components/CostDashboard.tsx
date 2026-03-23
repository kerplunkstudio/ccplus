import React, { useState, useEffect } from 'react';
import './CostDashboard.css';
import { CostDashboardData } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

const formatCost = (cost: number): string => {
  return `$${cost.toFixed(4)}`;
};

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const CostDashboard: React.FC = () => {
  const [data, setData] = useState<CostDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCostData = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${SOCKET_URL}/api/stats/costs`);

        if (response.ok) {
          const costData = await response.json();
          setData(costData);
        } else {
          const text = await response.text();
          let errorMessage: string;
          try {
            const errorData = JSON.parse(text);
            errorMessage = errorData.error || `HTTP ${response.status}`;
          } catch {
            errorMessage = `HTTP ${response.status}: ${text.substring(0, 100)}`;
          }
          setError(errorMessage);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Network error: ${message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchCostData();
  }, []);

  if (loading) {
    return (
      <div className="cost-dashboard">
        <div className="cost-dashboard-container">
          <div className="cost-loading">Loading cost data...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="cost-dashboard">
        <div className="cost-dashboard-container">
          <div className="cost-error">{error || 'Failed to load cost data'}</div>
        </div>
      </div>
    );
  }

  // Calculate max cost for bar chart scaling
  const maxDailyCost = Math.max(...data.daily_trend.map(d => d.cost), 0.01);

  return (
    <div className="cost-dashboard">
      <div className="cost-dashboard-container">
        {/* Header */}
        <div className="cost-header">
          <h1 className="cost-title">Cost Dashboard</h1>
        </div>

        {/* Hero cards */}
        <div className="cost-hero-row">
          <div className="cost-hero-card">
            <div className="cost-hero-label">Today</div>
            <div className="cost-hero-value">{formatCost(data.hero.today)}</div>
          </div>
          <div className="cost-hero-card">
            <div className="cost-hero-label">This Week</div>
            <div className="cost-hero-value">{formatCost(data.hero.this_week)}</div>
          </div>
          <div className="cost-hero-card">
            <div className="cost-hero-label">This Month</div>
            <div className="cost-hero-value">{formatCost(data.hero.this_month)}</div>
          </div>
        </div>

        <div className="cost-divider" />

        {/* Daily cost trend */}
        <div className="cost-section">
          <h2 className="cost-section-title">Daily Cost Trend (Last 14 Days)</h2>
          <div className="cost-chart-container">
            <div className="cost-chart-bars">
              {data.daily_trend.map((day) => {
                const height = Math.max((day.cost / maxDailyCost) * 100, 2);
                return (
                  <div
                    key={day.date}
                    className="cost-chart-bar-wrapper"
                    data-tooltip={`${formatDate(day.date)} • ${formatCost(day.cost)} • ${formatNumber(day.input_tokens + day.output_tokens)} tokens`}
                  >
                    <div
                      className="cost-chart-bar"
                      style={{ height: `${height}%` }}
                    />
                    <div className="cost-chart-label">{formatDate(day.date)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="cost-divider" />

        {/* Cost by model */}
        <div className="cost-section">
          <h2 className="cost-section-title">Cost by Model</h2>
          {data.by_model.length > 0 ? (
            <div className="cost-table">
              <div className="cost-table-header">
                <div className="cost-table-cell cost-table-cell-model">Model</div>
                <div className="cost-table-cell cost-table-cell-queries">Queries</div>
                <div className="cost-table-cell cost-table-cell-cost">Cost</div>
                <div className="cost-table-cell cost-table-cell-tokens">Tokens</div>
              </div>
              {data.by_model.map((model) => {
                const modelShortName = model.model.replace(/-\d{8}$/, '');
                const totalTokens = model.input_tokens + model.output_tokens;
                return (
                  <div key={model.model} className="cost-table-row">
                    <div className="cost-table-cell cost-table-cell-model" title={model.model}>
                      {modelShortName}
                    </div>
                    <div className="cost-table-cell cost-table-cell-queries">
                      {formatNumber(model.queries)}
                    </div>
                    <div className="cost-table-cell cost-table-cell-cost">
                      {formatCost(model.total_cost)}
                    </div>
                    <div className="cost-table-cell cost-table-cell-tokens">
                      {formatNumber(totalTokens)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cost-empty">No model data</div>
          )}
        </div>

        <div className="cost-divider" />

        {/* Top sessions */}
        <div className="cost-section">
          <h2 className="cost-section-title">Top Sessions by Cost</h2>
          {data.top_sessions.length > 0 ? (
            <div className="cost-table">
              <div className="cost-table-header">
                <div className="cost-table-cell cost-table-cell-session">Session</div>
                <div className="cost-table-cell cost-table-cell-queries">Queries</div>
                <div className="cost-table-cell cost-table-cell-cost">Cost</div>
                <div className="cost-table-cell cost-table-cell-tokens">Tokens</div>
              </div>
              {data.top_sessions.map((session) => {
                const totalTokens = session.input_tokens + session.output_tokens;
                return (
                  <div key={session.session_id} className="cost-table-row">
                    <div className="cost-table-cell cost-table-cell-session" title={session.label}>
                      {session.label}
                    </div>
                    <div className="cost-table-cell cost-table-cell-queries">
                      {formatNumber(session.query_count)}
                    </div>
                    <div className="cost-table-cell cost-table-cell-cost">
                      {formatCost(session.total_cost)}
                    </div>
                    <div className="cost-table-cell cost-table-cell-tokens">
                      {formatNumber(totalTokens)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cost-empty">No session data</div>
          )}
        </div>
      </div>
    </div>
  );
};
