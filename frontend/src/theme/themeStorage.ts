import { Theme } from './themeTypes'

export function saveTheme(theme: Theme): void {
  localStorage.setItem('cc-theme', JSON.stringify(theme))
}

export function loadTheme(): Theme | null {
  try {
    const stored = localStorage.getItem('cc-theme')
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function clearTheme(): void {
  localStorage.removeItem('cc-theme')
}
