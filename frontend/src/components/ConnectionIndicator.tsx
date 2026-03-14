import React, { useState, useEffect } from 'react';
import './ConnectionIndicator.css';

interface ConnectionIndicatorProps {
  connected: boolean;
  className?: string;
}

const CONNECTION_MESSAGES = {
  connected: [
    'Observatory online',
    'Intelligence flowing',
    'Agents ready',
    'Systems operational',
    'Watching closely'
  ],
  connecting: [
    'Establishing link...',
    'Awakening systems...',
    'Calibrating sensors...',
    'Initializing protocols...',
    'Syncing frequencies...'
  ],
  disconnected: [
    'Link interrupted',
    'Signal lost',
    'Attempting reconnection',
    'Restoring contact',
    'Reestablishing...'
  ]
};

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({
  connected,
  className = ''
}) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [previousConnected, setPreviousConnected] = useState(connected);
  const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'disconnected'>(
    connected ? 'connected' : 'disconnected'
  );

  // Handle connection state changes
  useEffect(() => {
    if (connected !== previousConnected) {
      if (connected) {
        setConnectionState('connected');
      } else {
        setConnectionState('connecting');
        // Simulate reconnection attempt
        const timeout = setTimeout(() => {
          if (!connected) {
            setConnectionState('disconnected');
          }
        }, 3000);
        return () => clearTimeout(timeout);
      }
      setPreviousConnected(connected);
    }
  }, [connected, previousConnected]);

  // Cycle through messages
  useEffect(() => {
    const messages = CONNECTION_MESSAGES[connectionState];
    if (messages.length <= 1) return;

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, connectionState === 'connected' ? 8000 : 3000);

    return () => clearInterval(interval);
  }, [connectionState]);

  const currentMessage = CONNECTION_MESSAGES[connectionState][messageIndex];

  return (
    <div className={`connection-indicator ${connectionState} ${className}`}>
      <div className="connection-visual">
        {/* Main status dot */}
        <div className="status-dot-main">
          <div className="dot-core" />
          {connectionState === 'connected' && <div className="dot-pulse" />}
          {connectionState === 'connecting' && (
            <>
              <div className="dot-search-ring" />
              <div className="dot-search-ring secondary" />
            </>
          )}
        </div>

        {/* Signal waves for connected state */}
        {connectionState === 'connected' && (
          <div className="signal-waves">
            <div className="wave" style={{ '--delay': '0s' } as React.CSSProperties} />
            <div className="wave" style={{ '--delay': '0.3s' } as React.CSSProperties} />
            <div className="wave" style={{ '--delay': '0.6s' } as React.CSSProperties} />
          </div>
        )}
      </div>

      <div className="connection-text">
        <span className="connection-label">OBS</span>
        <span className="connection-message">{currentMessage}</span>
      </div>

      {/* Background glow effect */}
      <div className="connection-glow" />
    </div>
  );
};