import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ThemePanel } from '../ThemePanel'
import { ThemeProvider } from '../../theme'

const renderWithTheme = (component: React.ReactElement) => {
  return render(<ThemeProvider>{component}</ThemeProvider>)
}

describe('ThemePanel', () => {
  test('does not render when isOpen is false', () => {
    renderWithTheme(<ThemePanel isOpen={false} onClose={() => {}} />)
    expect(screen.queryByText('Theme Settings')).not.toBeInTheDocument()
  })

  test('renders when isOpen is true', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Theme Settings')).toBeInTheDocument()
  })

  test('renders all 6 preset cards', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Matrix')).toBeInTheDocument()
    expect(screen.getByText('Friendly')).toBeInTheDocument()
    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.getByText('Ocean')).toBeInTheDocument()
    expect(screen.getByText('Monokai')).toBeInTheDocument()
  })

  test('calls onClose when close button is clicked', () => {
    const onClose = jest.fn()
    renderWithTheme(<ThemePanel isOpen={true} onClose={onClose} />)

    const closeBtn = screen.getByLabelText('Close theme panel')
    fireEvent.click(closeBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when overlay is clicked', () => {
    const onClose = jest.fn()
    const { container } = renderWithTheme(<ThemePanel isOpen={true} onClose={onClose} />)

    const overlay = container.querySelector('.theme-panel-overlay')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('renders color picker inputs', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    const colorInputs = screen.getAllByDisplayValue(/^#/)
    expect(colorInputs.length).toBeGreaterThanOrEqual(2)
  })

  test('renders Apply Custom button', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Apply Custom')).toBeInTheDocument()
  })

  test('preset cards are keyboard accessible', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    const presetButton = screen.getByTitle('Default')
    expect(presetButton).toBeInTheDocument()
    expect(presetButton.tagName).toBe('BUTTON')
  })

  test('active preset has active class', () => {
    const { container } = renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)

    const presetCards = container.querySelectorAll('.theme-preset-card')
    expect(presetCards.length).toBe(6)

    const activeCard = container.querySelector('.theme-preset-card.active')
    expect(activeCard).toBeInTheDocument()
  })

  test('background color input updates on change', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    const bgInputs = screen.getAllByDisplayValue(/^#/)
    const bgInput = bgInputs[0] as HTMLInputElement

    fireEvent.change(bgInput, { target: { value: '#ff0000' } })
    expect(bgInput.value).toBe('#ff0000')
  })

  test('accent color input updates on change', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    const colorInputs = screen.getAllByDisplayValue(/^#/)
    const accentInput = colorInputs[1] as HTMLInputElement

    fireEvent.change(accentInput, { target: { value: '#00ff00' } })
    expect(accentInput.value).toBe('#00ff00')
  })

  test('renders Presets heading', () => {
    const { container } = renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    const headers = screen.getAllByText(/Presets|Custom Colors/)
    expect(headers.length).toBeGreaterThanOrEqual(2)
  })

  test('renders Custom Colors heading', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Custom Colors')).toBeInTheDocument()
  })

  test('has proper color picker labels', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Background')).toBeInTheDocument()
    expect(screen.getByText('Accent')).toBeInTheDocument()
  })

  test('Apply Custom button is clickable', () => {
    renderWithTheme(<ThemePanel isOpen={true} onClose={() => {}} />)
    const applyBtn = screen.getByText('Apply Custom') as HTMLButtonElement
    expect(applyBtn).not.toBeDisabled()
  })
})
