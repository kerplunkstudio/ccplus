import React from 'react';
import { SignalState } from '../types';
import './SignalBar.css';

const PHASE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  planning: {
    label: 'Planning',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="5" r="3" />
        <path d="M6 8v4l2 2 2-2V8" />
      </svg>
    ),
  },
  implementing: {
    label: 'Implementing',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <polyline points="4 4 1 8 4 12" />
        <polyline points="12 4 15 8 12 12" />
        <line x1="10" y1="3" x2="6" y2="13" />
      </svg>
    ),
  },
  testing: {
    label: 'Testing',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M6 1h4M7 1v4l-4 5v1h10v-1l-4-5V1" />
        <ellipse cx="8" cy="13" rx="4" ry="2" />
      </svg>
    ),
  },
  reviewing: {
    label: 'Reviewing',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="7" cy="7" r="4" />
        <line x1="10" y1="10" x2="14" y2="14" />
      </svg>
    ),
  },
  debugging: {
    label: 'Debugging',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <ellipse cx="8" cy="9" rx="4" ry="5" />
        <line x1="1" y1="7" x2="5" y2="7" />
        <line x1="11" y1="7" x2="15" y2="7" />
        <line x1="1" y1="11" x2="5" y2="11" />
        <line x1="11" y1="11" x2="15" y2="11" />
        <path d="M5 4L4 1M11 4l1-3" />
      </svg>
    ),
  },
  researching: {
    label: 'Researching',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="2" y="1" width="12" height="14" rx="1" />
        <line x1="5" y1="5" x2="11" y2="5" />
        <line x1="5" y1="8" x2="11" y2="8" />
        <line x1="5" y1="11" x2="9" y2="11" />
      </svg>
    ),
  },
};

interface SignalBarProps {
  signals: SignalState;
}

export const SignalBar: React.FC<SignalBarProps> = ({ signals }) => {
  const { status } = signals;

  if (!status) return null;

  const phaseMeta = PHASE_META[status.phase] || { label: status.phase, icon: null };

  return (
    <div className="signal-bar" role="status" aria-label="Agent progress">
      <div className="signal-status">
        <span className="signal-phase-icon">{phaseMeta.icon}</span>
        <span className="signal-phase-label">{phaseMeta.label}</span>
        {status.detail && <span className="signal-phase-detail">{status.detail}</span>}
      </div>
    </div>
  );
};
