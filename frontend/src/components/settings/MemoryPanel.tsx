import './settings-shared.css'
import './MemoryPanel.css'

interface MemoryPanelProps {
  config: {
    enabled: boolean
    distillation_enabled: boolean
    max_inject_tokens: number
    max_search_results: number
    search_timeout_ms: number
    distill_debounce_ms: number
    distill_min_messages: number
  } | null
  onUpdate: (key: string, value: string | boolean | number) => void
}

interface NumberRowProps {
  label: string
  description: string
  value: number
  configKey: string
  disabled: boolean
  onUpdate: (key: string, value: string | boolean | number) => void
}

function NumberRow({ label, description, value, configKey, disabled, onUpdate }: NumberRowProps) {
  return (
    <div className={`settings-row ${disabled ? 'settings-row--disabled' : ''}`}>
      <div className="settings-row-label">
        <span className="settings-row-name">{label}</span>
        <span className="settings-row-desc">{description}</span>
      </div>
      <div className="settings-row-control">
        <div className="settings-number-input">
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            className="settings-number-btn"
            disabled={disabled}
            onClick={() => onUpdate(configKey, Math.max(0, value - 1))}
          >
            −
          </button>
          <input
            type="number"
            aria-label={label}
            className="settings-number-field"
            value={value}
            disabled={disabled}
            onChange={(e) => onUpdate(configKey, Number(e.target.value))}
          />
          <button
            type="button"
            aria-label={`Increase ${label}`}
            className="settings-number-btn"
            disabled={disabled}
            onClick={() => onUpdate(configKey, value + 1)}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MemoryPanel({ config, onUpdate }: MemoryPanelProps) {
  const enabled = config?.enabled ?? true
  const distillationEnabled = config?.distillation_enabled ?? true
  const maxInjectTokens = config?.max_inject_tokens ?? 4096
  const maxSearchResults = config?.max_search_results ?? 5
  const searchTimeoutMs = config?.search_timeout_ms ?? 5000
  const distillDebounceMs = config?.distill_debounce_ms ?? 60000
  const distillMinMessages = config?.distill_min_messages ?? 3

  const dependentDisabled = !enabled

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Memory</h2>
        <p className="settings-panel-description">Session memory system for knowledge persistence across sessions.</p>
      </div>

      <div className="settings-rows">
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">Memory Enabled</span>
            <span className="settings-row-desc">Master switch. When off, no memory is searched or stored.</span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              aria-label="Memory Enabled"
              className={`settings-toggle ${enabled ? 'settings-toggle--on' : ''}`}
              onClick={() => onUpdate('enabled', !enabled)}
              aria-checked={enabled}
              role="switch"
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
        </div>

        <div className={`settings-row ${dependentDisabled ? 'settings-row--disabled' : ''}`}>
          <div className="settings-row-label">
            <span className="settings-row-name">Distillation Enabled</span>
            <span className="settings-row-desc">Auto-distill sessions to memory after completion. Requires Memory Enabled.</span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              aria-label="Distillation Enabled"
              className={`settings-toggle ${distillationEnabled && !dependentDisabled ? 'settings-toggle--on' : ''}`}
              onClick={() => !dependentDisabled && onUpdate('distillation_enabled', !distillationEnabled)}
              aria-checked={distillationEnabled && !dependentDisabled}
              aria-disabled={dependentDisabled}
              role="switch"
              disabled={dependentDisabled}
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
        </div>

        <NumberRow
          label="Max Inject Tokens"
          description="Maximum tokens of memory context injected into each session"
          value={maxInjectTokens}
          configKey="max_inject_tokens"
          disabled={dependentDisabled}
          onUpdate={onUpdate}
        />
        <NumberRow
          label="Max Search Results"
          description="Memory entries retrieved per search query"
          value={maxSearchResults}
          configKey="max_search_results"
          disabled={dependentDisabled}
          onUpdate={onUpdate}
        />
        <NumberRow
          label="Search Timeout (ms)"
          description="How long to wait for memory server response"
          value={searchTimeoutMs}
          configKey="search_timeout_ms"
          disabled={dependentDisabled}
          onUpdate={onUpdate}
        />
        <NumberRow
          label="Distillation Debounce (ms)"
          description="Minimum time between distillation runs for the same session"
          value={distillDebounceMs}
          configKey="distill_debounce_ms"
          disabled={dependentDisabled}
          onUpdate={onUpdate}
        />
        <NumberRow
          label="Min Messages for Distillation"
          description="Sessions with fewer messages are skipped during distillation"
          value={distillMinMessages}
          configKey="distill_min_messages"
          disabled={dependentDisabled}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  )
}
