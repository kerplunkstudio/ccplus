import React from 'react';
import { DiffFile } from '../types/index';

interface DiffFileListProps {
  files: DiffFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

const getStatusIcon = (status: string): { icon: string; color: string } => {
  switch (status) {
    case 'added':
      return { icon: '+', color: '#2ea043' };
    case 'modified':
      return { icon: '~', color: '#d29922' };
    case 'deleted':
      return { icon: '−', color: '#f85149' };
    case 'renamed':
      return { icon: '→', color: '#0969da' };
    default:
      return { icon: '?', color: '#6e7781' };
  }
};

const getBasename = (path: string): string => {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? path : path.substring(lastSlash + 1);
};

const sortFiles = (files: DiffFile[]): DiffFile[] => {
  const order = { added: 0, modified: 1, deleted: 2, renamed: 3 };
  return [...files].sort((a, b) => {
    const aOrder = order[a.status] ?? 999;
    const bOrder = order[b.status] ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.path.localeCompare(b.path);
  });
};

export const DiffFileList: React.FC<DiffFileListProps> = ({ files, selectedFile, onSelectFile }) => {
  const sortedFiles = sortFiles(files);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '8px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        overflowY: 'auto',
        width: '220px',
        flexShrink: 0,
      }}
    >
      {sortedFiles.map((file) => {
        const { icon, color } = getStatusIcon(file.status);
        const isSelected = file.path === selectedFile;
        return (
          <button
            key={file.path}
            onClick={() => onSelectFile(file.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 8px',
              background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
              border: isSelected ? '1px solid var(--accent-border)' : '1px solid transparent',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
            }}
            title={file.path}
          >
            <span
              style={{
                color,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                width: '14px',
                flexShrink: 0,
                textAlign: 'center',
              }}
            >
              {icon}
            </span>
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {getBasename(file.path)}
            </span>
            <span
              style={{
                fontSize: '10px',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              +{file.additions} -{file.deletions}
            </span>
          </button>
        );
      })}
    </div>
  );
};
