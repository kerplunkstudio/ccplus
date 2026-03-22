import React, { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import ModelsPanel from './settings/ModelsPanel';
import SessionsPanel from './settings/SessionsPanel';
import MemoryPanel from './settings/MemoryPanel';
import WorkflowPanel from './settings/WorkflowPanel';
import CaptainPanel from './settings/CaptainPanel';
import IntegrationsPanel from './settings/IntegrationsPanel';
import './SettingsPage.css';

type SettingsCategory = 'models' | 'sessions' | 'memory' | 'workflow' | 'captain' | 'integrations';

interface Category {
  id: SettingsCategory;
  label: string;
  component: React.ComponentType<any>;
}

const CATEGORIES: Category[] = [
  { id: 'models', label: 'Models', component: ModelsPanel },
  { id: 'sessions', label: 'Sessions', component: SessionsPanel },
  { id: 'memory', label: 'Memory', component: MemoryPanel },
  { id: 'workflow', label: 'Workflow', component: WorkflowPanel },
  { id: 'captain', label: 'Captain', component: CaptainPanel },
  { id: 'integrations', label: 'Integrations', component: IntegrationsPanel },
];

interface SettingsPageProps {
  onClose: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onClose }) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('models');
  const { config, loading, error, restartRequired, updateSetting } = useSettings();

  const handleCategoryClick = (categoryId: SettingsCategory) => {
    setActiveCategory(categoryId);
  };

  const handleCloseClick = () => {
    onClose();
  };

  const ActivePanelComponent = CATEGORIES.find((cat) => cat.id === activeCategory)?.component || ModelsPanel;

  const categoryConfig = config?.[activeCategory] || {};

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <button
          className="settings-close-button"
          onClick={handleCloseClick}
          aria-label="Close settings"
        >
          ×
        </button>
      </div>

      {restartRequired && (
        <div className="settings-restart-banner" role="alert">
          <span className="settings-restart-icon">⚠</span>
          Some changes require a restart to take effect
        </div>
      )}

      {error && (
        <div className="settings-error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="settings-content">
        <aside className="settings-sidebar">
          <nav className="settings-category-nav" aria-label="Settings categories">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                className={`settings-category-item ${activeCategory === category.id ? 'active' : ''}`}
                onClick={() => handleCategoryClick(category.id)}
                aria-current={activeCategory === category.id ? 'page' : undefined}
              >
                <span className="settings-category-bullet">
                  {activeCategory === category.id ? '●' : '○'}
                </span>
                <span className="settings-category-label">{category.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-panel-area">
          {loading ? (
            <div className="settings-loading">
              <p>Loading settings...</p>
            </div>
          ) : (
            <ActivePanelComponent
              config={categoryConfig}
              onUpdate={(key: string, value: any) => updateSetting(activeCategory, key, value)}
            />
          )}
        </main>
      </div>
    </div>
  );
};
