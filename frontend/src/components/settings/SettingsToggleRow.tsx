import React from 'react';

interface SettingsToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  requiresRestart?: boolean;
}

export function SettingsToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  requiresRestart = false,
}: SettingsToggleRowProps) {
  return (
    <div className={`settings-row ${disabled ? 'disabled' : ''}`}>
      <div className="settings-row-label-group">
        <div className="settings-row-label">
          {label}
          {requiresRestart && <span className="settings-restart-badge">· restart required</span>}
        </div>
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      <div className="settings-row-control">
        <button
          className={`settings-toggle ${checked ? 'checked' : ''}`}
          onClick={() => onChange(!checked)}
          disabled={disabled}
          role="switch"
          aria-checked={checked}
          aria-label={label}
        />
      </div>
    </div>
  );
}
