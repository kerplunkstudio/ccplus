import React, { useState } from 'react';
import { useTrustScore } from '../hooks/useTrustScore';
import './TrustScore.css';

interface TrustScoreProps {
  sessionId: string;
  onClose: () => void;
}

export const TrustScore: React.FC<TrustScoreProps> = ({ sessionId, onClose }) => {
  const { trustScore, loading, error } = useTrustScore(sessionId);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(4)}`;
  };

  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  const getScoreColor = (score: number): string => {
    if (score > 80) return '#22C55E';
    if (score >= 50) return '#EAB308';
    return '#EF4444';
  };

  const getSeverityIcon = (severity: 'info' | 'warning' | 'critical'): string => {
    switch (severity) {
      case 'critical': return '⚠';
      case 'warning': return '!';
      case 'info': return 'i';
    }
  };

  const getSeverityColor = (severity: 'info' | 'warning' | 'critical'): string => {
    switch (severity) {
      case 'critical': return '#EF4444';
      case 'warning': return '#EAB308';
      case 'info': return '#0066cc';
    }
  };

  if (loading) {
    return (
      <div className="trust-score-panel">
        <div className="trust-score-header">
          <h2 className="trust-score-title">Trust Score</h2>
          <button className="trust-score-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="trust-score-loading">
          <div className="spinner" />
          <p>Loading trust metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trust-score-panel">
        <div className="trust-score-header">
          <h2 className="trust-score-title">Trust Score</h2>
          <button className="trust-score-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="trust-score-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!trustScore) {
    return null;
  }

  const scoreColor = getScoreColor(trustScore.overall_score);
  const { dimensions, summary, flags } = trustScore;

  return (
    <div className="trust-score-panel">
      <div className="trust-score-header">
        <h2 className="trust-score-title">Trust Score</h2>
        <button className="trust-score-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="trust-score-content">
        {/* Overall Score Gauge */}
        <div className="trust-score-gauge">
          <svg className="trust-gauge-ring" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="var(--border)"
              strokeWidth="8"
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke={scoreColor}
              strokeWidth="8"
              strokeDasharray={`${(trustScore.overall_score / 100) * 339.292} 339.292`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="trust-gauge-number" style={{ color: scoreColor }}>
            {trustScore.overall_score}
          </div>
          <div className="trust-gauge-label">Overall Trust</div>
        </div>

        {/* Dimensions */}
        <div className="trust-dimensions">
          <h3 className="trust-section-title">Dimensions</h3>
          {Object.entries(dimensions).map(([key, value]) => {
            const color = getScoreColor(value);
            const label = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            return (
              <div key={key} className="trust-dimension-row">
                <span className="trust-dimension-label">{label}</span>
                <div className="trust-dimension-bar-track">
                  <div
                    className="trust-dimension-bar-fill"
                    style={{ width: `${value}%`, backgroundColor: color }}
                  />
                </div>
                <span className="trust-dimension-value">{value}</span>
              </div>
            );
          })}
        </div>

        {/* Summary Stats */}
        <div className="trust-summary">
          <h3 className="trust-section-title">Summary</h3>
          <div className="trust-summary-grid">
            <div className="trust-summary-card">
              <div className="trust-summary-value">{formatNumber(summary.total_tool_calls)}</div>
              <div className="trust-summary-label">Tool Calls</div>
            </div>
            <div className="trust-summary-card">
              <div className="trust-summary-value">{formatNumber(summary.total_tokens)}</div>
              <div className="trust-summary-label">Tokens</div>
            </div>
            <div className="trust-summary-card">
              <div className="trust-summary-value">{formatCost(summary.total_cost_usd)}</div>
              <div className="trust-summary-label">Cost</div>
            </div>
            <div className="trust-summary-card">
              <div className="trust-summary-value">{formatDuration(summary.duration_ms)}</div>
              <div className="trust-summary-label">Duration</div>
            </div>
            <div className="trust-summary-card">
              <div className="trust-summary-value">{summary.tests_passed} / {summary.tests_run}</div>
              <div className="trust-summary-label">Tests Passed</div>
            </div>
            <div className="trust-summary-card">
              <div className="trust-summary-value">{summary.agents_spawned}</div>
              <div className="trust-summary-label">Agents</div>
            </div>
          </div>
        </div>

        {/* Flags */}
        {flags.length > 0 && (
          <div className="trust-flags">
            <h3 className="trust-section-title">Flags ({flags.length})</h3>
            <div className="trust-flag-list">
              {flags.map((flag, idx) => (
                <div key={idx} className="trust-flag-item">
                  <span
                    className="trust-flag-icon"
                    style={{ color: getSeverityColor(flag.severity) }}
                  >
                    {getSeverityIcon(flag.severity)}
                  </span>
                  <div className="trust-flag-content">
                    <div className="trust-flag-message">{flag.message}</div>
                    {flag.detail && <div className="trust-flag-detail">{flag.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File Lists */}
        <div className="trust-file-lists">
          {summary.files_touched.length > 0 && (
            <div className="trust-file-section">
              <button
                className="trust-file-section-header"
                onClick={() => toggleSection('touched')}
              >
                <span>Files Touched ({summary.files_touched.length})</span>
                <span className="trust-file-toggle">{expandedSection === 'touched' ? '−' : '+'}</span>
              </button>
              {expandedSection === 'touched' && (
                <div className="trust-file-list">
                  {summary.files_touched.map((file, idx) => (
                    <div key={idx} className="trust-file-item">{file}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {summary.files_created.length > 0 && (
            <div className="trust-file-section">
              <button
                className="trust-file-section-header"
                onClick={() => toggleSection('created')}
              >
                <span>Files Created ({summary.files_created.length})</span>
                <span className="trust-file-toggle">{expandedSection === 'created' ? '−' : '+'}</span>
              </button>
              {expandedSection === 'created' && (
                <div className="trust-file-list">
                  {summary.files_created.map((file, idx) => (
                    <div key={idx} className="trust-file-item">{file}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {summary.files_deleted.length > 0 && (
            <div className="trust-file-section">
              <button
                className="trust-file-section-header"
                onClick={() => toggleSection('deleted')}
              >
                <span>Files Deleted ({summary.files_deleted.length})</span>
                <span className="trust-file-toggle">{expandedSection === 'deleted' ? '−' : '+'}</span>
              </button>
              {expandedSection === 'deleted' && (
                <div className="trust-file-list">
                  {summary.files_deleted.map((file, idx) => (
                    <div key={idx} className="trust-file-item">{file}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
