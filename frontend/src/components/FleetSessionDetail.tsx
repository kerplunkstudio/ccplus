import React, { useMemo } from 'react';
import { useTabSocket } from '../hooks/useTabSocket';
import { ActivityTree } from './ActivityTree';
import './FleetSessionDetail.css';

interface FleetSessionDetailProps {
  sessionId: string;
  workspace: string;
  onBack: () => void;
  onOpenAsTab: (sessionId: string, workspace: string) => void;
}

export const FleetSessionDetail: React.FC<FleetSessionDetailProps> = ({
  sessionId,
  workspace,
  onBack,
  onOpenAsTab,
}) => {
  const {
    messages,
    activityTree,
    usageStats,
    isRestoringSession,
    connected,
  } = useTabSocket(sessionId);

  const initialPrompt = useMemo(() => {
    const firstUser = messages.find((m) => m.role === 'user');
    return firstUser?.content ?? null;
  }, [messages]);

  const handleOpenAsTab = () => {
    onOpenAsTab(sessionId, workspace);
  };

  return (
    <div className="fleet-session-detail">
      <div className="fleet-session-detail-header">
        <button className="fleet-session-detail-back" onClick={onBack} aria-label="Back to fleet">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Fleet
        </button>
        <div className="fleet-session-detail-id">{sessionId}</div>
      </div>

      <div className="fleet-session-detail-prompt">
        {isRestoringSession ? (
          <div className="fleet-prompt-loading">Loading...</div>
        ) : !connected ? (
          <div className="fleet-prompt-error">Disconnected</div>
        ) : initialPrompt ? (
          <blockquote className="fleet-prompt-text">{initialPrompt}</blockquote>
        ) : (
          <div className="fleet-prompt-empty">Waiting for prompt...</div>
        )}
      </div>

      <div className="fleet-session-detail-activity">
        <ActivityTree tree={activityTree} usageStats={usageStats} />
      </div>

      <button className="fleet-session-detail-open-btn" onClick={handleOpenAsTab}>
        <span className="fleet-open-label">Open full session</span>
        <span className="fleet-open-arrow">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </span>
      </button>
    </div>
  );
};
