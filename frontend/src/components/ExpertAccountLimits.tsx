import React, { useEffect, useState, useCallback } from 'react';
import './ExpertAccountLimits.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface Limits {
  requests_limit: number;
  requests_remaining: number;
  requests_reset: string | null;
  tokens_limit: number;
  tokens_remaining: number;
  tokens_reset: string | null;
}

interface AccountLimitsData {
  success: boolean;
  limits?: Limits;
  error?: string;
  cached?: boolean;
  fetched_at?: string;
}

const formatResetTime = (resetTime: string | null): string => {
  if (!resetTime) return '---';

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    if (diffMs < 0) return 'RST';

    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return `${diffSecs}s`;

    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m`;

    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;
    return remainingMins > 0 ? `${diffHours}h${remainingMins}m` : `${diffHours}h`;
  } catch {
    return '---';
  }
};

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

const calculateUtilization = (remaining: number, limit: number): number => {
  if (limit === 0) return 0;
  return Math.round(((limit - remaining) / limit) * 100);
};

const getCapacityStatus = (remaining: number, limit: number): 'high' | 'medium' | 'low' | 'critical' => {
  const percentage = (remaining / limit) * 100;
  if (percentage > 75) return 'high';
  if (percentage > 50) return 'medium';
  if (percentage > 25) return 'low';
  return 'critical';
};

export const ExpertAccountLimits: React.FC = () => {
  const [data, setData] = useState<AccountLimitsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLimits = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${SOCKET_URL}/api/account/limits`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch account limits');
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLimits();
    // Refresh every 30 seconds
    const interval = setInterval(fetchLimits, 30000);
    return () => clearInterval(interval);
  }, [fetchLimits]);

  if (loading && !data) {
    return (
      <div className="expert-limits">
        <div className="limits-header">
          <span className="limits-title">API CAPACITY</span>
          <div className="loading-indicator" />
        </div>
        <div className="limits-loading">
          <span className="loading-text">FETCHING...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="expert-limits expert-limits-error">
        <div className="limits-header">
          <span className="limits-title">API CAPACITY</span>
          <button onClick={fetchLimits} className="retry-btn" aria-label="Retry">
            ↻
          </button>
        </div>
        <div className="error-state">
          <span className="error-code">ERR</span>
          <span className="error-message">{error.includes('API key') ? 'NO_KEY' : 'FETCH_FAIL'}</span>
        </div>
      </div>
    );
  }

  if (!data || !data.success || !data.limits) {
    return null;
  }

  const { limits } = data;
  const requestsUtil = calculateUtilization(limits.requests_remaining, limits.requests_limit);
  const tokensUtil = calculateUtilization(limits.tokens_remaining, limits.tokens_limit);
  const requestsStatus = getCapacityStatus(limits.requests_remaining, limits.requests_limit);
  const tokensStatus = getCapacityStatus(limits.tokens_remaining, limits.tokens_limit);

  return (
    <div className="expert-limits">
      <div className="limits-header">
        <span className="limits-title">API CAPACITY</span>
        <div className="limits-controls">
          {data.cached && <span className="cache-indicator">CACHED</span>}
          <button onClick={fetchLimits} className="refresh-btn" aria-label="Refresh">
            ↻
          </button>
        </div>
      </div>

      <div className="limits-grid">
        {/* Requests Section */}
        <div className="limit-section">
          <div className="limit-metric">
            <span className="metric-label">REQ/MIN</span>
            <div className="metric-values">
              <span className="metric-current">{formatNumber(limits.requests_remaining)}</span>
              <span className="metric-separator">∕</span>
              <span className="metric-total">{formatNumber(limits.requests_limit)}</span>
            </div>
          </div>
          <div className="limit-details">
            <div className={`utilization-bar utilization-${requestsStatus}`}>
              <div
                className="utilization-fill"
                style={{ width: `${requestsUtil}%` }}
              />
            </div>
            <div className="limit-info">
              <span className={`capacity-status status-${requestsStatus}`}>
                {requestsStatus.toUpperCase()}
              </span>
              <span className="reset-time">
                RST {formatResetTime(limits.requests_reset)}
              </span>
            </div>
          </div>
        </div>

        {/* Tokens Section */}
        <div className="limit-section">
          <div className="limit-metric">
            <span className="metric-label">TOK/MIN</span>
            <div className="metric-values">
              <span className="metric-current">{formatNumber(limits.tokens_remaining)}</span>
              <span className="metric-separator">∕</span>
              <span className="metric-total">{formatNumber(limits.tokens_limit)}</span>
            </div>
          </div>
          <div className="limit-details">
            <div className={`utilization-bar utilization-${tokensStatus}`}>
              <div
                className="utilization-fill"
                style={{ width: `${tokensUtil}%` }}
              />
            </div>
            <div className="limit-info">
              <span className={`capacity-status status-${tokensStatus}`}>
                {tokensStatus.toUpperCase()}
              </span>
              <span className="reset-time">
                RST {formatResetTime(limits.tokens_reset)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {data.fetched_at && (
        <div className="limits-footer">
          <span className="timestamp">
            {new Date(data.fetched_at).toLocaleTimeString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </span>
        </div>
      )}
    </div>
  );
};