import React, { useState } from 'react';
import { PluginMarketplace } from './PluginMarketplace';
import { InstalledPlugins } from './InstalledPlugins';
import './PluginModal.css';

interface PluginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'marketplace' | 'installed';

export const PluginModal: React.FC<PluginModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('marketplace');

  if (!isOpen) return null;

  return (
    <div className="plugin-modal-overlay" onClick={onClose}>
      <div className="plugin-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="plugin-modal-header">
          <div className="plugin-modal-tabs">
            <button
              className={`plugin-modal-tab ${activeTab === 'marketplace' ? 'active' : ''}`}
              onClick={() => setActiveTab('marketplace')}
            >
              Marketplace
            </button>
            <button
              className={`plugin-modal-tab ${activeTab === 'installed' ? 'active' : ''}`}
              onClick={() => setActiveTab('installed')}
            >
              Installed
            </button>
          </div>
          <button className="plugin-modal-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="plugin-modal-content">
          {activeTab === 'marketplace' && <PluginMarketplace onClose={onClose} />}
          {activeTab === 'installed' && <InstalledPlugins onClose={onClose} />}
        </div>
      </div>
    </div>
  );
};
