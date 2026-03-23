import React, { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { ModelsPanel } from './settings/ModelsPanel';
import { SessionsPanel } from './settings/SessionsPanel';
import { MemoryPanel } from './settings/MemoryPanel';
import { WorkflowPanel } from './settings/WorkflowPanel';
import { CaptainPanel } from './settings/CaptainPanel';
import { IntegrationsPanel } from './settings/IntegrationsPanel';
import './SettingsPage.css';

type SettingsCategory =
  | 'models'
  | 'sessions'
  | 'memory'
  | 'workflow'
  | 'captain'
  | 'integrations';

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('models');
  const { config, loading, error, needsRestart, updateConfig } = useSettings();

  const renderPanel = () => {
    if (loading) {
      return (
        <div className="settings-panel">
          <div className="settings-panel-header">
            <h2 className="settings-panel-title">Loading...</h2>
          </div>
          <div className="settings-row">
            <div className="settings-skeleton" style={{ width: '300px' }} />
          </div>
          <div className="settings-row">
            <div className="settings-skeleton" style={{ width: '250px' }} />
          </div>
          <div className="settings-row">
            <div className="settings-skeleton" style={{ width: '280px' }} />
          </div>
        </div>
      );
    }

    switch (activeCategory) {
      case 'models':
        return <ModelsPanel config={config.models} onUpdate={updateConfig} />;
      case 'sessions':
        return <SessionsPanel config={config.sessions} onUpdate={updateConfig} />;
      case 'memory':
        return <MemoryPanel config={config.memory} onUpdate={updateConfig} />;
      case 'workflow':
        return <WorkflowPanel config={config.workflow} onUpdate={updateConfig} />;
      case 'captain':
        return <CaptainPanel config={config.captain} onUpdate={updateConfig} />;
      case 'integrations':
        return <IntegrationsPanel config={config.integrations} onUpdate={updateConfig} />;
      default:
        return <ModelsPanel config={config.models} onUpdate={updateConfig} />;
    }
  };

  return (
    <div className="settings-container">
      {error && (
        <div
          style={{
            position: 'fixed',
            top: '12px',
            right: '12px',
            background: 'var(--error)',
            color: 'white',
            padding: 'var(--space-sm) var(--space-md)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            zIndex: 1000,
          }}
        >
          {error}
        </div>
      )}
      {needsRestart && (
        <div
          className="settings-restart-toast"
        >
          Restart required for changes to take effect
        </div>
      )}
      <aside className="settings-sidebar">
        <button
          onClick={onClose}
          className="settings-close-btn"
          aria-label="Close settings"
        >
          ×
        </button>
        <nav>
          <ul className="settings-sidebar-list">
            <li
              className={`settings-sidebar-item ${activeCategory === 'models' ? 'active' : ''}`}
              onClick={() => setActiveCategory('models')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setActiveCategory('models');
                }
              }}
            >
              Models
            </li>
            <li
              className={`settings-sidebar-item ${activeCategory === 'sessions' ? 'active' : ''}`}
              onClick={() => setActiveCategory('sessions')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setActiveCategory('sessions');
                }
              }}
            >
              Sessions
            </li>
            <li
              className={`settings-sidebar-item ${activeCategory === 'memory' ? 'active' : ''}`}
              onClick={() => setActiveCategory('memory')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setActiveCategory('memory');
                }
              }}
            >
              Memory
            </li>
            <li
              className={`settings-sidebar-item ${activeCategory === 'workflow' ? 'active' : ''}`}
              onClick={() => setActiveCategory('workflow')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setActiveCategory('workflow');
                }
              }}
            >
              Workflow
            </li>
            <li
              className={`settings-sidebar-item ${activeCategory === 'captain' ? 'active' : ''}`}
              onClick={() => setActiveCategory('captain')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setActiveCategory('captain');
                }
              }}
            >
              Captain
            </li>
            <li
              className={`settings-sidebar-item ${activeCategory === 'integrations' ? 'active' : ''}`}
              onClick={() => setActiveCategory('integrations')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setActiveCategory('integrations');
                }
              }}
            >
              Integrations
            </li>
          </ul>
        </nav>
      </aside>
      <main className="settings-main">{renderPanel()}</main>
    </div>
  );
}
