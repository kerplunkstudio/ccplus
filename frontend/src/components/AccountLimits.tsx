import React, { useEffect, useState, useCallback } from 'react';
import './AccountLimits.css';

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
  if (!resetTime) return 'Unknown';

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    if (diffMs < 0) return 'Resetting...';

    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return `${diffSecs}s`;

    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m`;

    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ${diffMins % 60}m`;
  } catch {
    return 'Unknown';
  }
};

const formatNumber = (num: number): string => {
  return num.toLocaleString();
};

const calculatePercentage = (remaining: number, limit: number): number => {
  if (limit === 0) return 0;
  return Math.round((remaining / limit) * 100);
};

export const AccountLimits: React.FC = () => {
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
      console.error('Failed to fetch account limits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLimits();
    // Refresh every 30 seconds to update reset times
    const interval = setInterval(fetchLimits, 30000);
    return () => clearInterval(interval);
  }, [fetchLimits]);

  if (loading && !data) {
    return (
      <div className="account-limits loading">
        <div className="spinner-small" />
        <span>Loading account limits...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="account-limits error">
        <div className="error-icon">⚠️</div>
        <div className="error-message">
          <strong>Failed to load account limits</strong>
          <p>{error}</p>
        </div>
        <button onClick={fetchLimits} className="retry-button">
          Retry
        </button>
      </div>
    );
  }

  if (!data || !data.success || !data.limits) {
    return null;
  }

  const { limits } = data;
  const requestsPercentage = calculatePercentage(limits.requests_remaining, limits.requests_limit);
  const tokensPercentage = calculatePercentage(limits.tokens_remaining, limits.tokens_limit);

  // Determine status color based on remaining percentage
  const getStatusClass = (percentage: number): string => {
    if (percentage > 50) return 'status-good';
    if (percentage > 20) return 'status-warning';
    return 'status-critical';
  };

  return (
    <div className="account-limits">
      <div className="account-limits-header">
        <h3>Claude API Limits</h3>
        {data.cached && <span className="cached-badge">Cached</span>}
        <button
          onClick={fetchLimits}
          className="refresh-button"
          title="Refresh limits"
          aria-label="Refresh account limits"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      <div className="limits-grid">
        <div className={`limit-card ${getStatusClass(requestsPercentage)}`}>
          <div className="limit-label">
            <span className="limit-icon">🔄</span>
            <span>Requests / Minute</span>
          </div>
          <div className="limit-value">
            <span className="remaining">{formatNumber(limits.requests_remaining)}</span>
            <span className="separator">/</span>
            <span className="total">{formatNumber(limits.requests_limit)}</span>
          </div>
          <div className="limit-progress-bar">
            <div
              className="limit-progress-fill"
              style={{ width: `${requestsPercentage}%` }}
            />
          </div>
          <div className="limit-reset">
            Resets in {formatResetTime(limits.requests_reset)}
          </div>
        </div>

        <div className={`limit-card ${getStatusClass(tokensPercentage)}`}>
          <div className="limit-label">
            <span className="limit-icon">🪙</span>
            <span>Tokens / Minute</span>
          </div>
          <div className="limit-value">
            <span className="remaining">{formatNumber(limits.tokens_remaining)}</span>
            <span className="separator">/</span>
            <span className="total">{formatNumber(limits.tokens_limit)}</span>
          </div>
          <div className="limit-progress-bar">
            <div
              className="limit-progress-fill"
              style={{ width: `${tokensPercentage}%` }}
            />
          </div>
          <div className="limit-reset">
            Resets in {formatResetTime(limits.tokens_reset)}
          </div>
        </div>
      </div>

      {data.fetched_at && (
        <div className="limits-footer">
          <span className="last-updated">
            Last updated: {new Date(data.fetched_at).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
};
