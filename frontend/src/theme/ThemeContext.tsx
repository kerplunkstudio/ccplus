import React, { useEffect, useState } from 'react'
import { applyTheme } from './applyTheme'
import { THEME, getThemeById } from './themePresets'

const PROFILE_STORAGE_KEY = 'ccplus_profile_settings'

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

  return <>{children}</>
}
