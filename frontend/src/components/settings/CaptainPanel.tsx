import React from 'react';
import { CaptainConfig } from '../../hooks/useSettings';
import { SettingsToggleRow } from './SettingsToggleRow';

interface CaptainPanelProps {
  config: CaptainConfig | null;
  onUpdate: (key: string, value: unknown) => void;
}

export function CaptainPanel({ config, onUpdate }: CaptainPanelProps) {
  if (!config) {
    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Captain</h2>
          <p className="settings-panel-description">
            Configure the autonomous Captain agent settings
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
        <h2 className="settings-panel-title">Captain</h2>
        <p className="settings-panel-description">
          Configure the autonomous Captain agent settings
        </p>
      </div>

      <SettingsToggleRow
        label="Auto-start"
        description="Automatically start Captain when cc+ launches"
        checked={config.autoStart}
        onChange={(checked) => onUpdate('captain.autoStart', checked)}
        requiresRestart
      />

      <SettingsToggleRow
        label="Resume on Startup"
        description="Resume previous Captain session on launch"
        checked={config.resumeOnStartup}
        onChange={(checked) => onUpdate('captain.resumeOnStartup', checked)}
        requiresRestart
      />

      <div className="settings-row">
        <div className="settings-row-label-group">
          <div className="settings-row-label">
            Captain Workspace
            <span className="settings-restart-badge">· restart required</span>
          </div>
          <div className="settings-row-description">
            Dedicated workspace directory for Captain operations
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="text"
            className="settings-text-input"
            value={config.captainWorkspace}
            onChange={(e) => onUpdate('captain.captainWorkspace', e.target.value)}
            placeholder="/path/to/captain/workspace"
          />
        </div>
      </div>

      <SettingsToggleRow
        label="Allow Edits"
        description="Allow Captain to edit files directly"
        checked={config.allowEdits}
        onChange={(checked) => onUpdate('captain.allowEdits', checked)}
      />

      <SettingsToggleRow
        label="Allow Bash"
        description="Allow Captain to execute bash commands"
        checked={config.allowBash}
        onChange={(checked) => onUpdate('captain.allowBash', checked)}
      />
    </div>
  );
}
