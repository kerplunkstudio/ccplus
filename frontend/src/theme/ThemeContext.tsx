import React, { useEffect } from 'react'
import { applyTheme } from './applyTheme'
import { THEME } from './themePresets'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme(THEME)
  }, [])

  return <>{children}</>
}
