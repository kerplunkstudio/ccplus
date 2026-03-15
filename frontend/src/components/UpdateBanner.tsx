import React, { useState, useEffect } from 'react';
import './UpdateBanner.css';

interface UpdateInfo {
  update_available: boolean;
  current_version: string;
  latest_version: string;
  channel: string;
}

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

const UpdateBanner: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const response = await fetch(`${SOCKET_URL}/api/update-check`);
        if (response.ok) {
          const data: UpdateInfo = await response.json();

          // Check if user has dismissed this version
          const dismissedVersion = localStorage.getItem('ccplus_dismissed_update_version');
          if (dismissedVersion === data.latest_version) {
            setDismissed(true);
          }

          setUpdateInfo(data);
        }
      } catch (error) {
        // Silently fail, update banner is optional
        console.debug('Failed to check for updates:', error);
      }
    };

    checkForUpdates();
  }, []);

  const handleDismiss = () => {
    if (updateInfo) {
      localStorage.setItem('ccplus_dismissed_update_version', updateInfo.latest_version);
      setDismissed(true);
    }
  };

  if (!updateInfo || !updateInfo.update_available || dismissed) {
    return null;
  }

  return (
    <div className="update-banner">
      <div className="update-banner-content">
        <span className="update-banner-icon">↑</span>
        <span className="update-banner-message">
          cc+ v{updateInfo.latest_version} is available. Run{' '}
          <code className="update-banner-command">./ccplus update</code> to upgrade.
        </span>
      </div>
      <button
        className="update-banner-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss update notification"
      >
        ×
      </button>
    </div>
  );
};

export default UpdateBanner;
