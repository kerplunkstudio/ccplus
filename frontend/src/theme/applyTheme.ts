import { Theme } from './themeTypes'

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const colors = theme.colors

  // Map theme colors to CSS custom properties
  root.style.setProperty('--color-background', colors.background)
  root.style.setProperty('--color-accent', colors.accent)
  root.style.setProperty('--color-text', colors.text)
  root.style.setProperty('--color-border', colors.border)
  root.style.setProperty('--color-hover', colors.hover)
  root.style.setProperty('--color-success', colors.success)
  root.style.setProperty('--color-warning', colors.warning)
  root.style.setProperty('--color-error', colors.error)

  // Map to the primary CSS variable names used throughout
  root.style.setProperty('--bg-primary', colors.background)
  root.style.setProperty('--bg-secondary', colors.hover)
  root.style.setProperty('--bg-tertiary', colors.background)
  root.style.setProperty('--text-primary', colors.text)
  root.style.setProperty('--text-secondary', adjustBrightness(colors.text, -40))
  root.style.setProperty('--accent', colors.accent)
  root.style.setProperty('--accent-dim', adjustBrightness(colors.accent, -40))
  root.style.setProperty('--accent-light', adjustBrightness(colors.accent, 40))
  root.style.setProperty('--border', colors.border)
  root.style.setProperty('--success', colors.success)
  root.style.setProperty('--warning', colors.warning)
  root.style.setProperty('--error', colors.error)
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
