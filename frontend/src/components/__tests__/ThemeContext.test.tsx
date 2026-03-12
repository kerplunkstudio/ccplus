import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ThemeProvider, useTheme } from '../../theme'
import { THEME_PRESETS } from '../../theme/themePresets'

const TestComponent = ({ onThemeChange }: { onThemeChange?: (name: string) => void }) => {
  const { theme, applyPreset, setTheme } = useTheme()

  return (
    <div>
      <div data-testid="current-theme">{theme.name}</div>
      <div data-testid="current-preset">{theme.presetId}</div>
      <div data-testid="current-bg">{theme.colors.background}</div>
      <button
        onClick={() => {
          applyPreset('matrix')
          onThemeChange?.('matrix')
        }}
      >
        Apply Matrix
      </button>
      <button
        onClick={() => {
          applyPreset('ocean')
          onThemeChange?.('ocean')
        }}
      >
        Apply Ocean
      </button>
      <button
        onClick={() => {
          setTheme({
            ...theme,
            colors: { ...theme.colors, accent: '#ff0000' }
          })
        }}
      >
        Change Accent
      </button>
      <button
        onClick={() => {
          setTheme({
            ...theme,
            colors: { ...theme.colors, background: '#ff0000' }
          })
        }}
      >
        Change Background
      </button>
    </div>
  )
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  test('provides default theme when no theme is saved', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    expect(screen.getByTestId('current-theme')).toHaveTextContent('Default')
    expect(screen.getByTestId('current-preset')).toHaveTextContent('default')
  })

  test('applyPreset updates theme to Matrix', () => {
    const { rerender } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyMatrixBtn = screen.getByText('Apply Matrix')
    fireEvent.click(applyMatrixBtn)

    expect(screen.getByTestId('current-theme')).toHaveTextContent('Matrix')
    expect(screen.getByTestId('current-preset')).toHaveTextContent('matrix')
  })

  test('applyPreset updates theme to Ocean', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyOceanBtn = screen.getByText('Apply Ocean')
    fireEvent.click(applyOceanBtn)

    expect(screen.getByTestId('current-theme')).toHaveTextContent('Ocean')
    expect(screen.getByTestId('current-preset')).toHaveTextContent('ocean')
  })

  test('setTheme persists to localStorage', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const changeAccentBtn = screen.getByText('Change Accent')
    fireEvent.click(changeAccentBtn)

    const stored = localStorage.getItem('cc-theme')
    expect(stored).toBeTruthy()
    const parsedTheme = JSON.parse(stored!)
    expect(parsedTheme.colors.accent).toBe('#ff0000')
  })

  test('setTheme updates DOM CSS variables', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const changeBackgroundBtn = screen.getByText('Change Background')
    fireEvent.click(changeBackgroundBtn)

    const bgColor = document.documentElement.style.getPropertyValue('--color-background')
    expect(bgColor).toBe('#ff0000')
  })

  test('applyPreset persists theme to localStorage', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyMatrixBtn = screen.getByText('Apply Matrix')
    fireEvent.click(applyMatrixBtn)

    const stored = localStorage.getItem('cc-theme')
    expect(stored).toBeTruthy()
    const parsedTheme = JSON.parse(stored!)
    expect(parsedTheme.presetId).toBe('matrix')
  })

  test('applyPreset applies correct CSS variables', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyOceanBtn = screen.getByText('Apply Ocean')
    fireEvent.click(applyOceanBtn)

    const accentColor = document.documentElement.style.getPropertyValue('--color-accent')
    expect(accentColor).toBe(THEME_PRESETS.ocean.colors.accent)
  })

  test('throws error when useTheme is used outside ThemeProvider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation()

    const BadComponent = () => {
      useTheme()
      return null
    }

    expect(() => render(<BadComponent />)).toThrow(
      'useTheme must be used within ThemeProvider'
    )

    consoleError.mockRestore()
  })

  test('multiple theme changes update state correctly', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyMatrixBtn = screen.getByText('Apply Matrix')
    fireEvent.click(applyMatrixBtn)
    expect(screen.getByTestId('current-preset')).toHaveTextContent('matrix')

    const applyOceanBtn = screen.getByText('Apply Ocean')
    fireEvent.click(applyOceanBtn)
    expect(screen.getByTestId('current-preset')).toHaveTextContent('ocean')

    fireEvent.click(applyMatrixBtn)
    expect(screen.getByTestId('current-preset')).toHaveTextContent('matrix')
  })

  test('preserves theme across custom color changes', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyMatrixBtn = screen.getByText('Apply Matrix')
    fireEvent.click(applyMatrixBtn)

    const currentPresetBefore = screen.getByTestId('current-preset').textContent
    expect(currentPresetBefore).toBe('matrix')

    const changeAccentBtn = screen.getByText('Change Accent')
    fireEvent.click(changeAccentBtn)

    expect(screen.getByTestId('current-preset')).toHaveTextContent('matrix')
  })

  test('localStorage persists across component remount', () => {
    const { unmount } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyMatrixBtn = screen.getByText('Apply Matrix')
    fireEvent.click(applyMatrixBtn)

    unmount()

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    expect(screen.getByTestId('current-preset')).toHaveTextContent('matrix')
  })

  test('theme provider initializes from localStorage on mount', () => {
    const customTheme = THEME_PRESETS.friendly
    localStorage.setItem('cc-theme', JSON.stringify(customTheme))

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    expect(screen.getByTestId('current-preset')).toHaveTextContent('friendly')
  })

  test('applyPreset applies all color properties', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyOceanBtn = screen.getByText('Apply Ocean')
    fireEvent.click(applyOceanBtn)

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
      const cssValue = document.documentElement.style.getPropertyValue(`--color-${key}`)
      expect(cssValue).toBeTruthy()
    })
  })

  test('custom theme changes do not affect stored presetId', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const applyMatrixBtn = screen.getByText('Apply Matrix')
    fireEvent.click(applyMatrixBtn)

    const changeAccentBtn = screen.getByText('Change Accent')
    fireEvent.click(changeAccentBtn)

    const stored = localStorage.getItem('cc-theme')
    const parsedTheme = JSON.parse(stored!)
    expect(parsedTheme.presetId).toBe('matrix')
  })
})
