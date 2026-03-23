import React from 'react';
import { DiffFile, DiffLine } from '../types/index';
import './DiffView.css';

interface DiffViewProps {
  file: DiffFile;
}

const formatLineNumber = (num: number | null): string => {
  if (num === null) return ' ';
  return num.toString();
};

const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'added':
      return 'Added';
    case 'modified':
      return 'Modified';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    default:
      return status;
  }
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'added':
      return '#2ea043';
    case 'modified':
      return '#d29922';
    case 'deleted':
      return '#f85149';
    case 'renamed':
      return '#0969da';
    default:
      return 'var(--text-secondary)';
  }
};

export const DiffView: React.FC<DiffViewProps> = ({ file }) => {
  const isBinary = file.hunks.length === 0 && (file.additions > 0 || file.deletions > 0);

  return (
    <div className="diff-view">
      <div
        className="diff-view-header"
        style={{
          borderLeftColor: getStatusColor(file.status),
        }}
      >
        <span className="diff-view-status" style={{ color: getStatusColor(file.status) }}>
          {getStatusLabel(file.status)}
        </span>
        <span className="diff-view-path">{file.path}</span>
        <span className="diff-view-stats">
          +{file.additions} -{file.deletions}
        </span>
      </div>

      {isBinary ? (
        <div className="diff-view-binary">Binary file</div>
      ) : (
        <div className="diff-view-content">
          {file.hunks.map((hunk, hunkIdx) => (
            <div key={hunkIdx} className="diff-hunk">
              <div className="diff-hunk-header">{hunk.header}</div>
              <div className="diff-lines">
                {hunk.lines.map((line: DiffLine, lineIdx: number) => (
                  <div
                    key={lineIdx}
                    className={`diff-line diff-line-${line.type}`}
                  >
                    <span className="diff-line-number diff-line-number-old">
                      {formatLineNumber(line.oldLineNumber)}
                    </span>
                    <span className="diff-line-number diff-line-number-new">
                      {formatLineNumber(line.newLineNumber)}
                    </span>
                    <span className="diff-line-marker">
                      {line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '}
                    </span>
                    <span className="diff-line-content">{line.content}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
