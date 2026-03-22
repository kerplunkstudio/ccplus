import './settings-shared.css'
import './SessionsPanel.css'

interface SessionsPanelProps {
  config: {
    workspace_path: string
    bypass_permissions: boolean
  } | null
  onUpdate: (key: string, value: string | boolean | number) => void
}

export default function SessionsPanel({ config, onUpdate }: SessionsPanelProps) {
  const workspacePath = config?.workspace_path ?? '~/Workspace'
  const bypassPermissions = config?.bypass_permissions ?? true

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Sessions</h2>
        <p className="settings-panel-description">How SDK sessions behave.</p>
      </div>

      <div className="settings-rows">
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">Default Workspace Path</span>
            <span className="settings-row-desc">Default directory opened when starting a new session</span>
          </div>
          <div className="settings-row-control">
            <input
              type="text"
              aria-label="Default Workspace Path"
              className="settings-text-input"
              value={workspacePath}
              onChange={e => onUpdate('workspace_path', e.target.value)}
              placeholder="~/Workspace"
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-name">Bypass Permissions</span>
            <span className="settings-row-desc">When on, the SDK runs without per-tool permission prompts</span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              aria-label="Bypass Permissions"
              className={`settings-toggle ${bypassPermissions ? 'settings-toggle--on' : ''}`}
              onClick={() => onUpdate('bypass_permissions', !bypassPermissions)}
              aria-checked={bypassPermissions}
              role="switch"
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
