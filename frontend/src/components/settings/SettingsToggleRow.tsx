import './settings-shared.css'

interface SettingsToggleRowProps {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  restartRequired?: boolean
  onChange: (value: boolean) => void
}

export default function SettingsToggleRow({
  label,
  description,
  checked,
  disabled = false,
  restartRequired = false,
  onChange,
}: SettingsToggleRowProps) {
  return (
    <div className={`setting-row${disabled ? ' setting-row--disabled' : ''}`}>
      <div className="setting-info">
        <span className="setting-label">
          {label}
          {restartRequired && <span className="restart-badge">(restart required)</span>}
        </span>
        <span className="setting-description">{description}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`toggle${checked ? ' toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  )
}
