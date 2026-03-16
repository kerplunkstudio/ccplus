import React, { useState } from 'react';
import './AppLoadingScreen.css';

interface AppLoadingScreenProps {
  ready: boolean;
}

export function AppLoadingScreen({ ready }: AppLoadingScreenProps) {
  const [exited, setExited] = useState(false);

  const handleTransitionEnd = () => {
    if (ready) {
      setExited(true);
    }
  };

  if (exited) {
    return null;
  }

  return (
    <div
      className={`app-loading-screen ${ready ? 'app-loading-screen--exiting' : ''}`}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="app-loading-content">
        <h1 className="app-loading-wordmark">cc+</h1>
        <div className="app-loading-pulse" />
      </div>
    </div>
  );
}
