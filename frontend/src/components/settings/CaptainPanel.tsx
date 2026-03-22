import './settings-shared.css'
import './CaptainPanel.css'
import SettingsToggleRow from './SettingsToggleRow'

interface CaptainPanelProps {
  config: {
    auto_start: boolean
    resume_on_startup: boolean
    workspace_path: string
    allow_edits: boolean
    allow_bash: boolean
  } | null
  onUpdate: (key: string, value: unknown) => void
}

interface TextRowProps {
  label: string
  description: string
  value: string
  placeholder?: string
  restartRequired?: boolean
  onChange: (value: string) => void
}

function TextRow({ label, description, value, placeholder, restartRequired = false, onChange }: TextRowProps) {
  return (
    <div className="setting-row setting-row--column">
      <div className="setting-info">
        <span className="setting-label">
          {label}
          {restartRequired && <span className="restart-badge">(restart required)</span>}
        </span>
        <span className="setting-description">{description}</span>
      </div>
      <input
        type="text"
        className="setting-input"
        value={value}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </div>
  )
}

export default function CaptainPanel({ config, onUpdate }: CaptainPanelProps) {
  const cfg = config ?? {
    auto_start: true,
    resume_on_startup: true,
    workspace_path: '',
    allow_edits: false,
    allow_bash: true,
  }

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2 className="panel-title">Captain</h2>
        <p className="panel-description">The persistent orchestrator session.</p>
      </div>

      <div className="settings-list">
        <SettingsToggleRow
          label="Auto-start Captain"
          description="Automatically start Captain when cc+ launches"
          checked={cfg.auto_start}
          restartRequired
          onChange={(value) => onUpdate('auto_start', value)}
        />
        <SettingsToggleRow
          label="Resume on Startup"
          description="Resume previous Captain conversation on restart"
          checked={cfg.resume_on_startup}
          restartRequired
          onChange={(value) => onUpdate('resume_on_startup', value)}
        />
        <TextRow
          label="Captain Workspace"
          description="Working directory for the Captain session"
          value={cfg.workspace_path}
          placeholder="Inherits from Sessions workspace"
          restartRequired
          onChange={(value) => onUpdate('workspace_path', value)}
        />
        <SettingsToggleRow
          label="Allow Edits"
          description="Allow Captain to use Edit and Write tools directly (not recommended)"
          checked={cfg.allow_edits}
          onChange={(value) => onUpdate('allow_edits', value)}
        />
        <SettingsToggleRow
          label="Allow Bash"
          description="Allow Captain to execute Bash commands"
          checked={cfg.allow_bash}
          onChange={(value) => onUpdate('allow_bash', value)}
        />
      </div>
    </div>
  )
}
