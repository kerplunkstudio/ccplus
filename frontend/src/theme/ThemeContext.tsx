import React, { useEffect, useState, createContext, useContext, useMemo } from 'react'
import { applyTheme, isLightTheme } from './applyTheme'
import { THEME, getThemeById } from './themePresets'

const PROFILE_STORAGE_KEY = 'ccplus_profile_settings'

interface ThemeContextValue {
  isLight: boolean
}

const ThemeContext = createContext<ThemeContextValue>({ isLight: false })

export function useTheme() {
  return useContext(ThemeContext)
}

function loadSavedTheme(): string {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!stored) return THEME.presetId
    const parsed = JSON.parse(stored)
    return parsed.theme || THEME.presetId
  } catch {
    return THEME.presetId
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentThemeId, setCurrentThemeId] = useState<string>(loadSavedTheme)

  const contextValue = useMemo(() => {
    const theme = getThemeById(currentThemeId)
    return {
      isLight: isLightTheme(theme.colors.background)
    }
  }, [currentThemeId])

  useEffect(() => {
    const theme = getThemeById(currentThemeId)
    applyTheme(theme)
  }, [currentThemeId])

  useEffect(() => {
    const handleStorageChange = () => {
      const newThemeId = loadSavedTheme()
      setCurrentThemeId(newThemeId)
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>
}
