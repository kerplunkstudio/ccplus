import React, { useState, useEffect, useRef } from 'react';
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
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Focus trap and restoration
  useEffect(() => {
    if (!isOpen) return;

    // Save previously focused element
    previousActiveElementRef.current = document.activeElement as HTMLElement;

    // Focus modal
    if (modalRef.current) {
      modalRef.current.focus();
    }

    // Handle keyboard events (Escape to close)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }

      // Simple focus trap: keep Tab within modal
      if (e.key === 'Tab') {
        if (!modalRef.current) return;

        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Restore focus on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="plugin-modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="plugin-modal-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-modal-title"
        tabIndex={-1}
      >
        <div className="plugin-modal-header">
          <div className="plugin-modal-tabs" role="tablist" aria-label="Plugin views">
            <button
              className={`plugin-modal-tab ${activeTab === 'marketplace' ? 'active' : ''}`}
              onClick={() => setActiveTab('marketplace')}
              role="tab"
              aria-selected={activeTab === 'marketplace'}
              aria-controls="plugin-panel-marketplace"
              id="plugin-modal-title"
            >
              Marketplace
            </button>
            <button
              className={`plugin-modal-tab ${activeTab === 'installed' ? 'active' : ''}`}
              onClick={() => setActiveTab('installed')}
              role="tab"
              aria-selected={activeTab === 'installed'}
              aria-controls="plugin-panel-installed"
            >
              Installed
            </button>
          </div>
          <button className="plugin-modal-close" onClick={onClose} aria-label="Close plugin modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="plugin-modal-content" role="tabpanel" id={`plugin-panel-${activeTab}`}>
          {activeTab === 'marketplace' && <PluginMarketplace onClose={onClose} />}
          {activeTab === 'installed' && <InstalledPlugins onClose={onClose} />}
        </div>
      </div>
    </div>
  );
};
