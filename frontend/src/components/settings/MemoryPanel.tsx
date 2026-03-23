import React from 'react';
import { MemoryConfig } from '../../hooks/useSettings';
import { SettingsToggleRow } from './SettingsToggleRow';

interface MemoryPanelProps {
  config: MemoryConfig | null;
  onUpdate: (key: string, value: unknown) => void;
}

export function MemoryPanel({ config, onUpdate }: MemoryPanelProps) {
  if (!config) {
    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Memory</h2>
          <p className="settings-panel-description">
            Configure memory system for cross-session context persistence
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
        <h2 className="settings-panel-title">Memory</h2>
        <p className="settings-panel-description">
          Configure memory system for cross-session context persistence
        </p>
      </div>

      <SettingsToggleRow
        label="Memory Enabled"
        description="Enable persistent memory across sessions"
        checked={config.enabled}
        onChange={(checked) => onUpdate('memory.enabled', checked)}
      />

      <SettingsToggleRow
        label="Distillation Enabled"
        description="Automatically distill conversations into memory"
        checked={config.distillationEnabled}
        onChange={(checked) => onUpdate('memory.distillationEnabled', checked)}
        disabled={!config.enabled}
      />

      <div className={`settings-row ${!config.enabled ? 'disabled' : ''}`}>
        <div className="settings-row-label-group">
          <div className="settings-row-label">Max Inject Tokens</div>
          <div className="settings-row-description">
            Maximum tokens to inject from memory
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="number"
            className="settings-number-input"
            value={config.maxInjectTokens}
            onChange={(e) => onUpdate('memory.maxInjectTokens', Number(e.target.value))}
            min={1000}
            max={10000}
            step={100}
            disabled={!config.enabled}
          />
        </div>
      </div>

      <div className={`settings-row ${!config.enabled ? 'disabled' : ''}`}>
        <div className="settings-row-label-group">
          <div className="settings-row-label">Max Search Results</div>
          <div className="settings-row-description">
            Maximum number of memory search results
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="number"
            className="settings-number-input"
            value={config.maxSearchResults}
            onChange={(e) => onUpdate('memory.maxSearchResults', Number(e.target.value))}
            min={1}
            max={50}
            disabled={!config.enabled}
          />
        </div>
      </div>

      <div className={`settings-row ${!config.enabled ? 'disabled' : ''}`}>
        <div className="settings-row-label-group">
          <div className="settings-row-label">Search Timeout</div>
          <div className="settings-row-description">
            Memory search timeout in milliseconds
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="number"
            className="settings-number-input"
            value={config.searchTimeout}
            onChange={(e) => onUpdate('memory.searchTimeout', Number(e.target.value))}
            min={1000}
            max={30000}
            step={1000}
            disabled={!config.enabled}
          />
        </div>
      </div>

      <div className={`settings-row ${!config.enabled ? 'disabled' : ''}`}>
        <div className="settings-row-label-group">
          <div className="settings-row-label">Distill Debounce</div>
          <div className="settings-row-description">
            Delay before distilling after conversation pauses (ms)
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="number"
            className="settings-number-input"
            value={config.distillDebounce}
            onChange={(e) => onUpdate('memory.distillDebounce', Number(e.target.value))}
            min={5000}
            max={120000}
            step={5000}
            disabled={!config.enabled}
          />
        </div>
      </div>

      <div className={`settings-row ${!config.enabled ? 'disabled' : ''}`}>
        <div className="settings-row-label-group">
          <div className="settings-row-label">Min Messages</div>
          <div className="settings-row-description">
            Minimum messages before distillation triggers
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="number"
            className="settings-number-input"
            value={config.minMessages}
            onChange={(e) => onUpdate('memory.minMessages', Number(e.target.value))}
            min={1}
            max={20}
            disabled={!config.enabled}
          />
        </div>
      </div>
    </div>
  );
}
