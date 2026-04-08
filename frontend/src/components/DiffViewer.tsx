import React, { useEffect } from 'react';
import './DiffViewer.css';
import { useDiff } from '../hooks/useDiff';
import type { DiffFile } from '../hooks/useDiff';

interface DiffViewerProps {
  sessionId: string;
}

function getStatusLabel(status: DiffFile['status']): string {
  switch (status) {
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    default: return 'M';
  }
}

function getStatusColor(status: DiffFile['status']): string {
  switch (status) {
    case 'added': return '#22c55e';
    case 'deleted': return '#ef4444';
    case 'renamed': return '#f59e0b';
    default: return 'var(--accent)';
  }
}

function getShortPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

export function DiffViewer({ sessionId }: DiffViewerProps) {
  const { diffResult, loading, error, selectedFile, fetchDiff, selectFile } = useDiff(sessionId);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  const handleFileClick = (path: string, index: number) => {
    selectFile(path);
    document.getElementById(`diff-file-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading) {
    return (
      <div className="diff-viewer">
        <div className="diff-state diff-state--loading">
          <p className="diff-state-label">Analyzing changes…</p>
          <div className="diff-state-skeleton" aria-hidden="true">
            <div className="diff-skeleton-row">
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-line diff-skeleton-line--long" />
            </div>
            <div className="diff-skeleton-row">
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-line diff-skeleton-line--addition diff-skeleton-line--medium" />
            </div>
            <div className="diff-skeleton-row">
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-line diff-skeleton-line--deletion diff-skeleton-line--short" />
            </div>
            <div className="diff-skeleton-row">
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-num" />
              <span className="diff-skeleton-line diff-skeleton-line--long" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="diff-viewer">
        <div className="diff-state diff-state--error">
          <p className="diff-state-context">Could not load the diff for this session.</p>
          <p className="diff-state-message">{error}</p>
          <button className="diff-state-action" onClick={fetchDiff}>Retry</button>
        </div>
      </div>
    );
  }

  if (!diffResult || diffResult.files.length === 0) {
    return (
      <div className="diff-viewer">
        <div className="diff-state diff-state--empty">
          <span className="diff-state-zero" aria-hidden="true">0</span>
          <p className="diff-state-heading">No changes detected</p>
          <p className="diff-state-body">
            This session may not have modified any files, or changes were already committed and merged.
          </p>
          <button className="diff-state-action" onClick={fetchDiff}>Refresh</button>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      {/* File sidebar */}
      <div className="diff-sidebar">
        <div className="diff-sidebar-header">{diffResult.files.length} file{diffResult.files.length !== 1 ? 's' : ''} changed</div>
        {diffResult.files.map((file, idx) => (
          <div
            key={file.path}
            className={`diff-sidebar-item${selectedFile === file.path ? ' diff-sidebar-item--selected' : ''}`}
            onClick={() => handleFileClick(file.path, idx)}
          >
            <span className="diff-sidebar-item-status" style={{ color: getStatusColor(file.status) }}>
              {getStatusLabel(file.status)}
            </span>
            <span className="diff-sidebar-item-path" title={file.path}>
              {getShortPath(file.path)}
            </span>
            <span className="diff-sidebar-item-counts">
              {file.additions > 0 && <span className="diff-sidebar-additions">+{file.additions}</span>}
              {file.deletions > 0 && <span className="diff-sidebar-deletions">-{file.deletions}</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Diff content */}
      <div className="diff-content">
        <div className="diff-summary">
          <span>Total:</span>
          <span className="diff-summary-additions">+{diffResult.totalAdditions}</span>
          <span className="diff-summary-deletions">-{diffResult.totalDeletions}</span>
        </div>
        {diffResult.files.map((file, fileIdx) => (
          <div key={file.path} id={`diff-file-${fileIdx}`} className="diff-file-section">
            <div className="diff-file-header">
              <span className="diff-file-status" style={{ color: getStatusColor(file.status) }}>
                {getStatusLabel(file.status)}
              </span>
              {file.status === 'renamed' && file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            </div>
            {file.hunks.map((hunk, hunkIdx) => (
              <div key={hunkIdx}>
                <div className="diff-hunk-header">{hunk.header}</div>
                {hunk.lines.map((line, lineIdx) => (
                  <div key={lineIdx} className={`diff-line diff-line--${line.type}`}>
                    <span className="diff-line-num">{line.oldLineNumber ?? ''}</span>
                    <span className="diff-line-num">{line.newLineNumber ?? ''}</span>
                    <span className="diff-line-content">{line.content}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
