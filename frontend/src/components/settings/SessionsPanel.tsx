import React from 'react';
import { SessionsConfig } from '../../hooks/useSettings';
import { SettingsToggleRow } from './SettingsToggleRow';

interface SessionsPanelProps {
  config: SessionsConfig | null;
  onUpdate: (key: string, value: unknown) => void;
}

export function SessionsPanel({ config, onUpdate }: SessionsPanelProps) {
  if (!config) {
    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Sessions</h2>
          <p className="settings-panel-description">
            Configure default session behavior and workspace settings
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
        <h2 className="settings-panel-title">Sessions</h2>
        <p className="settings-panel-description">
          Configure default session behavior and workspace settings
        </p>
      </div>

      <div className="settings-row">
        <div className="settings-row-label-group">
          <div className="settings-row-label">Default Workspace Path</div>
          <div className="settings-row-description">
            Default directory for new sessions
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="text"
            className="settings-text-input"
            value={config.workspacePath}
            onChange={(e) => onUpdate('sessions.workspacePath', e.target.value)}
            placeholder="/path/to/workspace"
          />
        </div>
      </div>

      <SettingsToggleRow
        label="Bypass Permissions"
        description="Skip permission prompts for file operations (use with caution)"
        checked={config.bypassPermissions}
        onChange={(checked) => onUpdate('sessions.bypassPermissions', checked)}
      />
    </div>
  );
}
