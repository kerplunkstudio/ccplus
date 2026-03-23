import React from 'react';
import { ModelsConfig } from '../../hooks/useSettings';

const AVAILABLE_MODELS = [
  'claude-sonnet-4.5-20250929',
  'claude-sonnet-4-20250514',
  'claude-haiku-4.5-20250815',
  'claude-opus-4-20250514',
];

const AGENT_TYPES = [
  { id: 'code_agent', label: 'code_agent' },
  { id: 'explore', label: 'explore' },
  { id: 'code-reviewer', label: 'code-reviewer' },
  { id: 'orchestrator', label: 'orchestrator' },
];

interface ModelsPanelProps {
  config: ModelsConfig | null;
  onUpdate: (key: string, value: unknown) => void;
}

export function ModelsPanel({ config, onUpdate }: ModelsPanelProps) {
  if (!config) {
    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Models</h2>
          <p className="settings-panel-description">
            Configure which Claude models are used for different operations
          </p>
        </div>
        <div className="settings-row">
          <div className="settings-skeleton" style={{ width: '200px' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Models</h2>
        <p className="settings-panel-description">
          Configure which Claude models are used for different operations
        </p>
      </div>

      <div className="settings-row">
        <div className="settings-row-label-group">
          <div className="settings-row-label">Default SDK Model</div>
          <div className="settings-row-description">
            Primary model for agent sessions and tools
          </div>
        </div>
        <div className="settings-row-control">
          <select
            className="settings-select"
            value={config.defaultModel}
            onChange={(e) => onUpdate('models.defaultModel', e.target.value)}
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label-group">
          <div className="settings-row-label">Captain Model</div>
          <div className="settings-row-description">
            Model used for the autonomous Captain agent
          </div>
        </div>
        <div className="settings-row-control">
          <select
            className="settings-select"
            value={config.captainModel}
            onChange={(e) => onUpdate('models.captainModel', e.target.value)}
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3 className="settings-section-header">Per-Agent Overrides</h3>

      {AGENT_TYPES.map((agent) => (
        <div className="settings-row" key={agent.id}>
          <div className="settings-row-label-group">
            <div className="settings-row-label">{agent.label}</div>
          </div>
          <div className="settings-row-control">
            <select
              className="settings-select"
              value={config.agent_overrides[agent.id] || 'inherit'}
              onChange={(e) => onUpdate(`models.agent_overrides.${agent.id}`, e.target.value)}
            >
              <option value="inherit">inherit</option>
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}
