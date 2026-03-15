import { Theme } from './themeTypes'

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const c = theme.colors

  // Base palette
  root.style.setProperty('--bg-primary', c.background)
  root.style.setProperty('--bg-secondary', c.hover)
  root.style.setProperty('--bg-tertiary', adjustBrightness(c.background, 10))
  root.style.setProperty('--text-primary', c.text)
  root.style.setProperty('--text-secondary', adjustBrightness(c.text, -40))
  root.style.setProperty('--accent', c.accent)
  const accentRgb = hexToRgb(c.accent)
  root.style.setProperty('--accent-rgb', `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`)
  root.style.setProperty('--accent-dim', adjustBrightness(c.accent, -40))
  root.style.setProperty('--accent-light', adjustBrightness(c.accent, 40))
  root.style.setProperty('--border', c.border)
  root.style.setProperty('--success', c.success)
  root.style.setProperty('--warning', c.warning)
  root.style.setProperty('--error', c.error)

  // Derived: accent
  root.style.setProperty('--accent-bg', withAlpha(c.accent, 0.1))
  root.style.setProperty('--accent-border', withAlpha(c.accent, 0.2))
  root.style.setProperty('--accent-shadow', withAlpha(c.accent, 0.4))
  root.style.setProperty('--accent-shadow-fade', withAlpha(c.accent, 0))
  root.style.setProperty('--accent-bg-active', withAlpha(c.accent, 0.15))
  root.style.setProperty('--accent-hover', adjustBrightness(c.accent, 20))

  // Derived: semantic
  root.style.setProperty('--success-bg', withAlpha(c.success, 0.15))
  root.style.setProperty('--success-border', withAlpha(c.success, 0.3))
  root.style.setProperty('--error-bg', withAlpha(c.error, 0.15))
  root.style.setProperty('--error-bg-subtle', withAlpha(c.error, 0.08))
  root.style.setProperty('--error-border', withAlpha(c.error, 0.3))
  root.style.setProperty('--border-subtle', withAlpha(c.text, 0.03))

  // Derived: interactive
  root.style.setProperty('--button-bg', withAlpha(c.text, 0.05))
  root.style.setProperty('--button-border', withAlpha(c.text, 0.12))
  root.style.setProperty('--button-text', withAlpha(c.text, 0.5))
  root.style.setProperty('--button-bg-hover', withAlpha(c.text, 0.08))
  root.style.setProperty('--button-border-hover', withAlpha(c.text, 0.2))
  root.style.setProperty('--button-text-hover', withAlpha(c.text, 0.7))
  root.style.setProperty('--hover-bg', withAlpha(c.text, 0.05))
  root.style.setProperty('--hover-border', withAlpha(c.text, 0.08))
  root.style.setProperty('--hover-bg-secondary', withAlpha(c.hover, 0.8))

  // Derived: surfaces
  root.style.setProperty('--icon-bg', withAlpha(c.text, 0.07))
  root.style.setProperty('--code-bg', 'rgba(0, 0, 0, 0.3)')
  root.style.setProperty('--code-header-bg', 'rgba(0, 0, 0, 0.5)')
  root.style.setProperty('--overlay-bg', 'rgba(0, 0, 0, 0.7)')
  root.style.setProperty('--dropdown-shadow', `0 8px 24px rgba(0, 0, 0, 0.4)`)
  root.style.setProperty('--shadow', 'rgba(0, 0, 0, 0.2)')
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const col = hex.startsWith('#') ? hex.slice(1) : hex
  const num = parseInt(col, 16)
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  }
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function adjustBrightness(hex: string, amount: number): string {
  const usePound = hex[0] === '#'
  const col = usePound ? hex.slice(1) : hex
  const num = parseInt(col, 16)
  const r = Math.max(0, Math.min(255, (num >> 16) + amount))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount))
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount))
  return (usePound ? '#' : '') + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)
}
