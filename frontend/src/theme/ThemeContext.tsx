import React, { createContext, useContext, useState, useEffect } from 'react'
import { Theme } from './themeTypes'
import { loadTheme, saveTheme } from './themeStorage'
import { applyTheme } from './applyTheme'
import { THEME_PRESETS } from './themePresets'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  applyPreset: (presetId: string) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(THEME_PRESETS.default)

  useEffect(() => {
    const stored = loadTheme()
    if (stored) {
      setThemeState(stored)
      applyTheme(stored)
    } else {
      applyTheme(THEME_PRESETS.default)
    }
  }, [])

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    saveTheme(newTheme)
    applyTheme(newTheme)
  }

  const applyPreset = (presetId: string) => {
    const preset = THEME_PRESETS[presetId]
    if (preset) {
      setTheme(preset)
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, applyPreset }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
