import React, { useState, useMemo } from 'react';
import { TrustMetrics, TrustFlag } from '../types';
import './TrustScore.css';

interface TrustScoreProps {
  sessionId: string;
  trustMetrics: TrustMetrics | null;
  loading: boolean;
  error: string | null;
}

export const TrustScore: React.FC<TrustScoreProps> = ({
  sessionId,
  trustMetrics,
  loading,
  error
}) => {
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
    return num.toLocaleString('en-US');
  };

  const getScoreColor = (score: number): string => {
    if (score > 80) return 'var(--success)';
    if (score >= 50) return 'var(--warning)';
    return 'var(--error)';
  };

  const isFile = (filePath: string): boolean => {
    const name = filePath.substring(filePath.lastIndexOf('/') + 1);
    return name.includes('.');
  };

  const shortenPath = (filePath: string): string => {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) return filePath;
    return filePath.substring(lastSlash + 1);
  };

  const dimensionLabels: Record<string, string> = useMemo(() => ({
    test_coverage: 'Tests',
    scope_discipline: 'Scope',
    error_rate: 'Errors',
    cost_efficiency: 'Cost',
    security: 'Security'
  }), []);

  const isMdOnlySession = useMemo(() => {
    if (!trustMetrics) return false;
    const allWritten = [...(trustMetrics.summary.files_written ?? []), ...trustMetrics.summary.files_deleted];
    return allWritten.length > 0 && allWritten.every(f => f.toLowerCase().endsWith('.md'));
  }, [trustMetrics]);

  if (loading) {
    return (
      <div className="trust-score-panel">
        <div className="trust-loading">
          <div className="trust-loading-spinner" />
          <p>Analyzing session...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trust-score-panel">
        <div className="trust-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!trustMetrics) {
    return (
      <div className="trust-score-panel">
        <div className="trust-empty">
          <p className="trust-empty-title">No trust metrics available</p>
          <p>Trust score will appear after the session completes</p>
        </div>
      </div>
    );
  }

  const { overall_score, dimensions, summary, flags } = trustMetrics;
  const scoreColor = getScoreColor(overall_score);
  const filesTouched = summary.files_touched.filter((f: string) => isFile(f));
  const filesCreated = summary.files_created.filter((f: string) => isFile(f));
  const filesDeleted = summary.files_deleted.filter((f: string) => isFile(f));

  return (
    <div className="trust-score-panel">
      <div className="trust-score-content">
        {/* Score header */}
        <div className="trust-score-header">
          <div className="trust-overall-score" style={{ color: scoreColor }}>
            {overall_score}
          </div>
          <div className="trust-overall-label">trust</div>
        </div>

        {/* Dimension bars */}
        <div className="trust-dimensions">
          {Object.entries(dimensions).map(([key, value]) => {
            const color = getScoreColor(value);
            const label = dimensionLabels[key] || key;
            return (
              <div key={key} className="trust-dimension-row">
                <span className="trust-dimension-label">
                  {label}{key === 'test_coverage' && isMdOnlySession ? ' (docs only)' : ''}
                </span>
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

        {/* Session facts */}
        <div className="trust-summary">
          <div className="trust-summary-row">
            <span className="trust-summary-label">Tool Calls</span>
            <span className="trust-summary-value">{formatNumber(summary.total_tool_calls)}</span>
          </div>
          <div className="trust-summary-row">
            <span className="trust-summary-label">Tokens</span>
            <span className="trust-summary-value">{formatNumber(summary.total_tokens)}</span>
          </div>
          <div className="trust-summary-row">
            <span className="trust-summary-label">Cost</span>
            <span className="trust-summary-value">{formatCost(summary.total_cost_usd)}</span>
          </div>
          <div className="trust-summary-row">
            <span className="trust-summary-label">Duration</span>
            <span className="trust-summary-value">{formatDuration(summary.duration_ms)}</span>
          </div>
          <div className="trust-summary-row">
            <span className="trust-summary-label">Tests</span>
            <span className="trust-summary-value">
              {summary.tests_passed} / {summary.tests_run}
            </span>
          </div>
          <div className="trust-summary-row">
            <span className="trust-summary-label">Agents</span>
            <span className="trust-summary-value">{summary.agents_spawned}</span>
          </div>
        </div>

        {/* Flags section */}
        {flags.length > 0 && (
          <div className="trust-flags">
            {flags.map((flag: TrustFlag, idx: number) => (
              <div
                key={idx}
                className="trust-flag-row"
                data-severity={flag.severity}
              >
                <div className="trust-flag-message">{flag.message}</div>
                {flag.detail && (
                  <div className="trust-flag-detail">{flag.detail}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* File sections */}
        <div className="trust-files">
          {filesTouched.length > 0 && (
            <div className="trust-file-section">
              <button
                className="trust-file-toggle"
                onClick={() => toggleSection('touched')}
              >
                <span className="trust-file-toggle-icon">
                  {expandedSection === 'touched' ? '−' : '+'}
                </span>
                <span>Files Touched ({filesTouched.length})</span>
              </button>
              {expandedSection === 'touched' && (
                <div className="trust-file-list">
                  {filesTouched.map((file, idx) => (
                    <div key={idx} className="trust-file-item" title={file}>{shortenPath(file)}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {filesCreated.length > 0 && (
            <div className="trust-file-section">
              <button
                className="trust-file-toggle"
                onClick={() => toggleSection('created')}
              >
                <span className="trust-file-toggle-icon">
                  {expandedSection === 'created' ? '−' : '+'}
                </span>
                <span>Files Created ({filesCreated.length})</span>
              </button>
              {expandedSection === 'created' && (
                <div className="trust-file-list">
                  {filesCreated.map((file, idx) => (
                    <div key={idx} className="trust-file-item" title={file}>{shortenPath(file)}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {filesDeleted.length > 0 && (
            <div className="trust-file-section">
              <button
                className="trust-file-toggle"
                onClick={() => toggleSection('deleted')}
              >
                <span className="trust-file-toggle-icon">
                  {expandedSection === 'deleted' ? '−' : '+'}
                </span>
                <span>Files Deleted ({filesDeleted.length})</span>
              </button>
              {expandedSection === 'deleted' && (
                <div className="trust-file-list">
                  {filesDeleted.map((file, idx) => (
                    <div key={idx} className="trust-file-item" title={file}>{shortenPath(file)}</div>
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
