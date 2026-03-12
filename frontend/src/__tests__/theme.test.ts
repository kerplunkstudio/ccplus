import { THEME_PRESETS } from '../theme/themePresets'
import { applyTheme } from '../theme/applyTheme'
import { saveTheme, loadTheme, clearTheme } from '../theme/themeStorage'
import { Theme } from '../theme/themeTypes'

describe('Theme System', () => {
  describe('THEME_PRESETS', () => {
    test('all presets have required properties', () => {
      Object.values(THEME_PRESETS).forEach((preset) => {
        expect(preset.name).toBeDefined()
        expect(preset.presetId).toBeDefined()
        expect(preset.colors).toBeDefined()
        expect(preset.colors.background).toBeDefined()
        expect(preset.colors.accent).toBeDefined()
        expect(preset.colors.text).toBeDefined()
        expect(preset.colors.border).toBeDefined()
        expect(preset.colors.hover).toBeDefined()
        expect(preset.colors.success).toBeDefined()
        expect(preset.colors.warning).toBeDefined()
        expect(preset.colors.error).toBeDefined()
      })
    })

    test('all colors are valid hex codes', () => {
      const hexRegex = /^#[0-9A-F]{6}$/i
      Object.values(THEME_PRESETS).forEach((preset) => {
        Object.values(preset.colors).forEach((color) => {
          expect(color).toMatch(hexRegex)
        })
      })
    })

    test('has exactly 6 presets', () => {
      expect(Object.keys(THEME_PRESETS)).toHaveLength(6)
    })

    test('preset IDs match expected names', () => {
      const expectedIds = ['default', 'matrix', 'friendly', 'light', 'ocean', 'monokai']
      expect(Object.keys(THEME_PRESETS).sort()).toEqual(expectedIds.sort())
    })

    test('each preset has matching name and presetId pattern', () => {
      Object.entries(THEME_PRESETS).forEach(([key, preset]) => {
        expect(preset.presetId).toBe(key)
        expect(preset.name).toBeTruthy()
        expect(typeof preset.name).toBe('string')
      })
    })
  })

  describe('applyTheme', () => {
    beforeEach(() => {
      document.documentElement.style.cssText = ''
    })

    test('applies theme colors to document root', () => {
      const theme = THEME_PRESETS.default
      applyTheme(theme)

      expect(document.documentElement.style.getPropertyValue('--color-background')).toBe(
        theme.colors.background
      )
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
        theme.colors.accent
      )
      expect(document.documentElement.style.getPropertyValue('--color-text')).toBe(
        theme.colors.text
      )
    })

    test('applies all 8 color properties', () => {
      const theme = THEME_PRESETS.matrix
      applyTheme(theme)

      const colorKeys = [
        'background',
        'accent',
        'text',
        'border',
        'hover',
        'success',
        'warning',
        'error'
      ]
      colorKeys.forEach((key) => {
        expect(document.documentElement.style.getPropertyValue(`--color-${key}`)).toBeTruthy()
      })
    })

    test('overwrites previous theme', () => {
      applyTheme(THEME_PRESETS.default)
      let bgColor = document.documentElement.style.getPropertyValue('--color-background')
      expect(bgColor).toBe('#1a1a2e')

      applyTheme(THEME_PRESETS.light)
      bgColor = document.documentElement.style.getPropertyValue('--color-background')
      expect(bgColor).toBe('#f8f9fa')
    })

    test('applies ocean theme correctly', () => {
      const theme = THEME_PRESETS.ocean
      applyTheme(theme)

      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(
        theme.colors.accent
      )
      expect(document.documentElement.style.getPropertyValue('--color-success')).toBe(
        theme.colors.success
      )
    })

    test('applies monokai theme correctly', () => {
      const theme = THEME_PRESETS.monokai
      applyTheme(theme)

      expect(document.documentElement.style.getPropertyValue('--color-text')).toBe(
        theme.colors.text
      )
    })
  })

  describe('localStorage operations', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    afterEach(() => {
      localStorage.clear()
    })

    test('saveTheme persists theme to localStorage', () => {
      const theme = THEME_PRESETS.ocean
      saveTheme(theme)

      const stored = localStorage.getItem('cc-theme')
      expect(stored).toBeTruthy()
      expect(JSON.parse(stored!)).toEqual(theme)
    })

    test('loadTheme retrieves saved theme', () => {
      const theme = THEME_PRESETS.monokai
      saveTheme(theme)

      const loaded = loadTheme()
      expect(loaded).toEqual(theme)
    })

    test('loadTheme returns null when no theme saved', () => {
      const loaded = loadTheme()
      expect(loaded).toBeNull()
    })

    test('loadTheme handles corrupted JSON gracefully', () => {
      localStorage.setItem('cc-theme', 'invalid-json{')
      const loaded = loadTheme()
      expect(loaded).toBeNull()
    })

    test('loadTheme handles empty string gracefully', () => {
      localStorage.setItem('cc-theme', '')
      const loaded = loadTheme()
      expect(loaded).toBeNull()
    })

    test('clearTheme removes theme from localStorage', () => {
      saveTheme(THEME_PRESETS.default)
      clearTheme()

      expect(localStorage.getItem('cc-theme')).toBeNull()
    })

    test('clearTheme is safe when nothing is stored', () => {
      expect(() => clearTheme()).not.toThrow()
      expect(localStorage.getItem('cc-theme')).toBeNull()
    })

    test('round-trip save and load preserves theme structure', () => {
      const original = THEME_PRESETS.friendly
      saveTheme(original)

      const loaded = loadTheme()
      expect(loaded?.name).toBe(original.name)
      expect(loaded?.presetId).toBe(original.presetId)
      expect(loaded?.colors).toEqual(original.colors)
    })
  })
})
