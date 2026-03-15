import React from 'react';
import './AmbientIndicator.css';

interface AmbientIndicatorProps {
  isActive: boolean;
  hasError?: boolean;
}

export const AmbientIndicator: React.FC<AmbientIndicatorProps> = ({
  isActive,
  hasError = false
}) => {
  if (!isActive && !hasError) return null;

  return (
    <div className={`ambient-indicator ${isActive ? 'active' : ''} ${hasError ? 'error' : ''}`}>
      <div className="ambient-core">
        <div className="ambient-inner" />
        <div className="ambient-ring" />
        <div className="ambient-ring ambient-ring-outer" />
      </div>
    </div>
  );
};