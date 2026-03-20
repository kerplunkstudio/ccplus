import React, { useState, useCallback } from 'react';
import { useDecisionTrail } from '../hooks/useDecisionTrail';
import { DecisionStep } from '../types';
import './DecisionTrail.css';

interface DecisionTrailProps {
  sessionId: string;
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
};

interface StepNodeProps {
  step: DecisionStep;
  path: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}

const StepNode: React.FC<StepNodeProps> = ({ step, path, collapsed, onToggle }) => {
  const hasChildren = step.children && step.children.length > 0;
  const isCollapsed = collapsed.has(path);

  const handleToggle = useCallback(() => {
    if (hasChildren) {
      onToggle(path);
    }
  }, [hasChildren, onToggle, path]);

  return (
    <div className="decision-step">
      <div className="decision-step-header">
        <div className={`decision-step-sequence ${step.success ? 'success' : 'failed'}`}>
          {step.sequence}
        </div>
        <div className="decision-step-content">
          <div className="decision-step-action">{step.action}</div>
          <div className="decision-step-meta">
            <span className="decision-step-tool">{step.tool}</span>
            {step.agent && <span className="decision-step-agent">{step.agent}</span>}
            <span className="decision-step-duration">{formatDuration(step.duration_ms)}</span>
          </div>
        </div>
        {hasChildren && (
          <button
            className="decision-step-toggle"
            onClick={handleToggle}
            aria-label={isCollapsed ? 'Expand children' : 'Collapse children'}
            aria-expanded={!isCollapsed}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div className="decision-step-children">
          {step.children!.map((child, childIndex) => (
            <StepNode
              key={child.sequence}
              step={child}
              path={`${path}.${childIndex}`}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const DecisionTrail: React.FC<DecisionTrailProps> = ({ sessionId }) => {
  const { trail, loading, error } = useDecisionTrail(sessionId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const handleToggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="decision-trail-container">
        <div className="decision-trail-empty">
          <div className="activity-empty-pulse" />
          <p className="activity-empty-title">Loading trail...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="decision-trail-container">
        <div className="decision-trail-empty">
          <p className="activity-empty-title">Error</p>
          <p className="activity-empty-sub">{error}</p>
        </div>
      </div>
    );
  }

  if (!trail || trail.steps.length === 0) {
    return (
      <div className="decision-trail-container">
        <div className="decision-trail-empty">
          <div className="activity-empty-pulse" />
          <p className="activity-empty-title">No decisions yet</p>
          <p className="activity-empty-sub">
            The agent decision trail will appear here after work begins
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="decision-trail-container">
      <div className="decision-trail-content">
        {trail.narrative && (
          <div className="decision-trail-narrative">
            <p>{trail.narrative}</p>
          </div>
        )}

        <div className="decision-trail-summary">
          <div className="decision-trail-stat">
            <div className="decision-trail-stat-value">{trail.total_steps}</div>
            <div className="decision-trail-stat-label">Steps</div>
          </div>
          <div className="decision-trail-stat">
            <div className="decision-trail-stat-value">{formatDuration(trail.total_duration_ms)}</div>
            <div className="decision-trail-stat-label">Duration</div>
          </div>
          <div className="decision-trail-stat">
            <div className="decision-trail-stat-value">{trail.files_touched.length}</div>
            <div className="decision-trail-stat-label">Files</div>
          </div>
          <div className="decision-trail-stat">
            <div className="decision-trail-stat-value">
              {trail.tests_run.passed}p/{trail.tests_run.failed}f
            </div>
            <div className="decision-trail-stat-label">Tests</div>
          </div>
        </div>

        <div className="decision-trail-steps">
          {trail.steps.map((step, index) => (
            <StepNode
              key={step.sequence}
              step={step}
              path={String(index)}
              collapsed={collapsed}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
