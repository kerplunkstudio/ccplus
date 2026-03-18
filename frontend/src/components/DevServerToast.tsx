import React, { useEffect, useState } from 'react';
import './DevServerToast.css';

interface DevServerToastProps {
  url: string;
  onDismiss: () => void;
  onFocusTab?: () => void;
}

export function DevServerToast({ url, onDismiss, onFocusTab }: DevServerToastProps) {
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  // Extract display label from URL (e.g., "localhost:3000")
  const label = url.replace(/^https?:\/\//, '');

  useEffect(() => {
    // Trigger slide-down animation after mount
    requestAnimationFrame(() => {
      setVisible(true);
    });

    // Auto-dismiss after 3 seconds
    const dismissTimer = setTimeout(() => {
      setFadeOut(true);
      setTimeout(() => {
        onDismiss();
      }, 200);
    }, 3000);

    return () => {
      clearTimeout(dismissTimer);
    };
  }, [onDismiss]);

  const handleClick = () => {
    if (onFocusTab) {
      onFocusTab();
    }
  };

  return (
    <div
      className={`dev-server-toast ${visible ? 'visible' : ''} ${fadeOut ? 'fade-out' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      <span className="dev-server-toast__icon">🚀</span>
      <span className="dev-server-toast__text">
        Dev server detected — opened in new tab: <strong>{label}</strong>
      </span>
    </div>
  );
}
