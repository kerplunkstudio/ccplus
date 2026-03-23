import React, { useState } from 'react';
import { useDiffReview } from '../hooks/useDiffReview';
import { DiffFileList } from './DiffFileList';
import { DiffView } from './DiffView';
import './DiffReviewPanel.css';

interface DiffReviewPanelProps {
  sessionId: string;
  streaming: boolean;
}

export const DiffReviewPanel: React.FC<DiffReviewPanelProps> = ({ sessionId, streaming }) => {
  const [expanded, setExpanded] = useState(false);

  const {
    diffResult,
    loading,
    error,
    selectedFile,
    commitMessage,
    committing,
    committed,
    commitHash,
    fetchDiff,
    commit,
    discard,
    selectFile,
    setCommitMessage,
  } = useDiffReview(sessionId, streaming);

  if (!sessionId) return null;

  if (loading) {
    return (
      <div className="diff-review-panel">
        <div className="diff-loading">
          <div className="diff-loading-spinner" />
          <p>Loading diff...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="diff-review-panel">
        <div className="diff-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!diffResult || diffResult.files.length === 0) {
    return null;
  }

  const selectedFileData = diffResult.files.find((f) => f.path === selectedFile);

  if (!expanded) {
    return (
      <div className="diff-review-collapsed">
        <button
          className="diff-summary-bar"
          onClick={() => setExpanded(true)}
          aria-label="Expand diff review"
        >
          <span className="diff-chevron">▸</span>
          <span className="diff-summary-text">
            {diffResult.files.length} file{diffResult.files.length !== 1 ? 's' : ''} changed
          </span>
          <span className="diff-summary-stats">
            +{diffResult.totalAdditions} -{diffResult.totalDeletions}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="diff-review-panel">
      <div className="diff-review-header">
        <button
          className="diff-collapse-btn"
          onClick={() => setExpanded(false)}
          aria-label="Collapse diff review"
        >
          <span className="diff-chevron">▾</span>
          <span className="diff-summary-text">
            {diffResult.files.length} file{diffResult.files.length !== 1 ? 's' : ''} changed
          </span>
          <span className="diff-summary-stats">
            +{diffResult.totalAdditions} -{diffResult.totalDeletions}
          </span>
        </button>
        <button
          className="diff-refresh-btn"
          onClick={fetchDiff}
          aria-label="Refresh diff"
          title="Refresh diff"
        >
          ⟳
        </button>
      </div>

      <div className="diff-review-body">
        <DiffFileList
          files={diffResult.files}
          selectedFile={selectedFile}
          onSelectFile={selectFile}
        />
        {selectedFileData && <DiffView file={selectedFileData} />}
      </div>

      {committed ? (
        <div className="diff-commit-success">
          <span className="diff-commit-success-icon">✓</span>
          <span className="diff-commit-success-text">
            Committed: {commitHash || 'success'}
          </span>
        </div>
      ) : (
        <div className="diff-commit-controls">
          <textarea
            className="diff-commit-message"
            placeholder="Enter commit message..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            disabled={committing}
            rows={2}
          />
          <div className="diff-commit-buttons">
            <button
              className="diff-commit-btn"
              onClick={commit}
              disabled={committing || !commitMessage.trim()}
            >
              {committing ? 'Committing...' : 'Commit'}
            </button>
            <button
              className="diff-discard-btn"
              onClick={discard}
              disabled={committing}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
