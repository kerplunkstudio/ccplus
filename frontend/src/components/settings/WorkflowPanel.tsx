import React from 'react';
import { WorkflowConfig } from '../../hooks/useSettings';
import { SettingsToggleRow } from './SettingsToggleRow';

interface WorkflowPanelProps {
  config: WorkflowConfig | null;
  onUpdate: (key: string, value: unknown) => void;
}

export function WorkflowPanel({ config, onUpdate }: WorkflowPanelProps) {
  if (!config) {
    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Workflow</h2>
          <p className="settings-panel-description">
            Configure workflow enforcement and quality gates
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
        <h2 className="settings-panel-title">Workflow</h2>
        <p className="settings-panel-description">
          Configure workflow enforcement and quality gates
        </p>
      </div>

      <SettingsToggleRow
        label="Workflow Enforcement"
        description="Enforce workflow policies and quality gates"
        checked={config.workflowEnforcement}
        onChange={(checked) => onUpdate('workflow.workflowEnforcement', checked)}
      />

      <SettingsToggleRow
        label="Worktrees Enabled"
        description="Use git worktrees for parallel development sessions"
        checked={config.worktreesEnabled}
        onChange={(checked) => onUpdate('workflow.worktreesEnabled', checked)}
      />
    </div>
  );
}
