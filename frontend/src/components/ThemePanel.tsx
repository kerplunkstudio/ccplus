import React, { useState } from 'react'
import { useTheme } from '../theme'
import { THEME_PRESETS } from '../theme/themePresets'
import './ThemePanel.css'

export function ThemePanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { theme, applyPreset, setTheme } = useTheme()
  const [customBgColor, setCustomBgColor] = useState(theme.colors.background)
  const [customAccentColor, setCustomAccentColor] = useState(theme.colors.accent)

  const handlePresetClick = (presetId: string) => {
    applyPreset(presetId)
  }

  const handleCustomApply = () => {
    const customTheme = {
      ...theme,
      name: 'Custom',
      colors: {
        ...theme.colors,
        background: customBgColor,
        accent: customAccentColor
      }
    }
    setTheme(customTheme)
  }

  if (!isOpen) return null

  return (
    <>
      <div className="theme-panel-overlay" onClick={onClose} />
      <div className="theme-panel">
        <div className="theme-panel-header">
          <h3>Theme Settings</h3>
          <button
            className="theme-panel-close"
            onClick={onClose}
            aria-label="Close theme panel"
          >
            ✕
          </button>
        </div>

        <div className="theme-panel-content">
          {/* Presets Section */}
          <div className="theme-section">
            <h4>Presets</h4>
            <div className="theme-grid">
              {Object.values(THEME_PRESETS).map((preset) => (
                <button
                  key={preset.presetId}
                  className={`theme-preset-card ${
                    theme.presetId === preset.presetId ? 'active' : ''
                  }`}
                  onClick={() => handlePresetClick(preset.presetId)}
                  style={{
                    backgroundColor: preset.colors.background,
                    borderColor: preset.colors.accent
                  }}
                  title={preset.name}
                >
                  <span className="preset-name">{preset.name}</span>
                  <span
                    className="preset-accent"
                    style={{ backgroundColor: preset.colors.accent }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Custom Colors Section */}
          <div className="theme-section">
            <h4>Custom Colors</h4>
            <div className="color-picker-group">
              <label>
                <span>Background</span>
                <div className="color-picker-input">
                  <input
                    type="color"
                    value={customBgColor}
                    onChange={(e) => setCustomBgColor(e.target.value)}
                  />
                  <span>{customBgColor}</span>
                </div>
              </label>
              <label>
                <span>Accent</span>
                <div className="color-picker-input">
                  <input
                    type="color"
                    value={customAccentColor}
                    onChange={(e) => setCustomAccentColor(e.target.value)}
                  />
                  <span>{customAccentColor}</span>
                </div>
              </label>
            </div>
            <button className="custom-apply-btn" onClick={handleCustomApply}>
              Apply Custom
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
