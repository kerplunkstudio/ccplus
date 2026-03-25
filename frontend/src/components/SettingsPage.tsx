import React, { useRef } from 'react';
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

const CATEGORIES: Array<{ id: SettingsCategory; label: string }> = [
  { id: 'models', label: 'Models' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'memory', label: 'Memory' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'captain', label: 'Captain' },
  { id: 'integrations', label: 'Integrations' },
];

export function SettingsPage() {
  const { config, loading, error, needsRestart, updateConfig } = useSettings();

  // Refs for scroll navigation
  const modelsRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<HTMLDivElement>(null);
  const memoryRef = useRef<HTMLDivElement>(null);
  const workflowRef = useRef<HTMLDivElement>(null);
  const captainRef = useRef<HTMLDivElement>(null);
  const integrationsRef = useRef<HTMLDivElement>(null);

  const sectionRefs: Record<SettingsCategory, React.RefObject<HTMLDivElement | null>> = {
    models: modelsRef,
    sessions: sessionsRef,
    memory: memoryRef,
    workflow: workflowRef,
    captain: captainRef,
    integrations: integrationsRef,
  };

  const scrollToSection = (category: SettingsCategory) => {
    const ref = sectionRefs[category];
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="settings-page">
      {error && (
        <div className="settings-error-toast">
          {error}
        </div>
      )}
      {needsRestart && (
        <div className="settings-restart-toast">
          Restart required for changes to take effect
        </div>
      )}

      <div className="settings-container">
        {/* Header */}
        <header className="settings-header">
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">
            Configure models, sessions, memory, and workflow preferences
          </p>
        </header>

        {/* Sticky Category Navigation */}
        <nav className="settings-nav" role="navigation" aria-label="Settings categories">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              className="settings-nav-pill"
              onClick={() => scrollToSection(category.id)}
              aria-label={`Scroll to ${category.label} settings`}
            >
              {category.label}
            </button>
          ))}
        </nav>

        {/* All Sections Rendered Vertically */}
        {loading ? (
          <div className="settings-loading">
            <div className="settings-loading-skeleton" />
            <div className="settings-loading-skeleton" />
            <div className="settings-loading-skeleton" />
          </div>
        ) : (
          <div className="settings-sections">
            <section ref={modelsRef} className="settings-section" style={{ animationDelay: '0.05s' }}>
              <ModelsPanel config={config.models} onUpdate={updateConfig} />
            </section>

            <section ref={sessionsRef} className="settings-section" style={{ animationDelay: '0.1s' }}>
              <SessionsPanel config={config.sessions} onUpdate={updateConfig} />
            </section>

            <section ref={memoryRef} className="settings-section" style={{ animationDelay: '0.15s' }}>
              <MemoryPanel config={config.memory} onUpdate={updateConfig} />
            </section>

            <section ref={workflowRef} className="settings-section" style={{ animationDelay: '0.2s' }}>
              <WorkflowPanel config={config.workflow} onUpdate={updateConfig} />
            </section>

            <section ref={captainRef} className="settings-section" style={{ animationDelay: '0.25s' }}>
              <CaptainPanel config={config.captain} onUpdate={updateConfig} />
            </section>

            <section ref={integrationsRef} className="settings-section" style={{ animationDelay: '0.3s' }}>
              <IntegrationsPanel config={config.integrations} onUpdate={updateConfig} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
