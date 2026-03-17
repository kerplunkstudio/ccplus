import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginModal } from './PluginModal';

// Mock child components
jest.mock('./PluginMarketplace', () => ({
  PluginMarketplace: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="plugin-marketplace">
      Marketplace Content
      {onClose && <button onClick={onClose}>Close from Marketplace</button>}
    </div>
  ),
}));

jest.mock('./InstalledPlugins', () => ({
  InstalledPlugins: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="installed-plugins">
      Installed Content
      {onClose && <button onClick={onClose}>Close from Installed</button>}
    </div>
  ),
}));

describe('PluginModal', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<PluginModal isOpen={false} onClose={mockOnClose} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders modal when isOpen is true', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders marketplace tab by default', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByTestId('plugin-marketplace')).toBeInTheDocument();
    expect(screen.getByText('Marketplace Content')).toBeInTheDocument();
  });

  it('renders both tab buttons', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByRole('tab', { name: /marketplace/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /installed/i })).toBeInTheDocument();
  });

  it('marketplace tab is active by default', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const marketplaceTab = screen.getByRole('tab', { name: /marketplace/i });
    expect(marketplaceTab).toHaveClass('active');
    expect(marketplaceTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to installed tab when clicked', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const installedTab = screen.getByRole('tab', { name: /installed/i });
    fireEvent.click(installedTab);

    expect(screen.getByTestId('installed-plugins')).toBeInTheDocument();
    expect(screen.getByText('Installed Content')).toBeInTheDocument();
    expect(installedTab).toHaveClass('active');
    expect(installedTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switches back to marketplace tab when clicked', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const installedTab = screen.getByRole('tab', { name: /installed/i });
    fireEvent.click(installedTab);

    expect(screen.getByTestId('installed-plugins')).toBeInTheDocument();

    const marketplaceTab = screen.getByRole('tab', { name: /marketplace/i });
    fireEvent.click(marketplaceTab);

    expect(screen.getByTestId('plugin-marketplace')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const closeButton = screen.getByRole('button', { name: /close plugin modal/i });
    expect(closeButton).toBeInTheDocument();
  });

  it('calls onClose when clicking close button', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const closeButton = screen.getByRole('button', { name: /close plugin modal/i });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking overlay', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const overlay = document.querySelector('.plugin-modal-overlay');
    fireEvent.click(overlay!);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside modal', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const modal = screen.getByRole('dialog');
    fireEvent.click(modal);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('closes modal on Escape key', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('has correct ARIA attributes', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'plugin-modal-title');
  });

  it('has tablist role on tabs container', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const tablist = screen.getByRole('tablist', { name: /plugin views/i });
    expect(tablist).toBeInTheDocument();
  });

  it('has tabpanel role on content area', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const tabpanel = screen.getByRole('tabpanel');
    expect(tabpanel).toBeInTheDocument();
    expect(tabpanel).toHaveAttribute('id', 'plugin-panel-marketplace');
  });

  it('updates tabpanel id when switching tabs', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const installedTab = screen.getByRole('tab', { name: /installed/i });
    fireEvent.click(installedTab);

    const tabpanel = screen.getByRole('tabpanel');
    expect(tabpanel).toHaveAttribute('id', 'plugin-panel-installed');
  });

  it('focuses modal when opened', async () => {
    const { rerender } = render(<PluginModal isOpen={false} onClose={mockOnClose} />);

    rerender(<PluginModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(document.activeElement).toBe(dialog);
    });
  });

  it('prevents tab from leaving modal (focus trap)', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const dialog = screen.getByRole('dialog');
    dialog.focus();

    // Simulate Tab key press
    fireEvent.keyDown(window, { key: 'Tab' });

    // Focus should still be within the modal
    const focusedElement = document.activeElement;
    expect(dialog.contains(focusedElement)).toBe(true);
  });

  it('handles Shift+Tab for reverse focus trap', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const dialog = screen.getByRole('dialog');
    const marketplaceTab = screen.getByRole('tab', { name: /marketplace/i });

    marketplaceTab.focus();

    // Simulate Shift+Tab key press
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    // Focus should still be within the modal
    const focusedElement = document.activeElement;
    expect(dialog.contains(focusedElement)).toBe(true);
  });

  it('restores focus to previous element when closed', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    const { rerender } = render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    rerender(<PluginModal isOpen={false} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });

    document.body.removeChild(button);
  });

  it('renders SVG icon in close button', () => {
    const { container } = render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const closeButton = screen.getByRole('button', { name: /close plugin modal/i });
    const svg = closeButton.querySelector('svg');

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('tabs have correct aria-controls attributes', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const marketplaceTab = screen.getByRole('tab', { name: /marketplace/i });
    const installedTab = screen.getByRole('tab', { name: /installed/i });

    expect(marketplaceTab).toHaveAttribute('aria-controls', 'plugin-panel-marketplace');
    expect(installedTab).toHaveAttribute('aria-controls', 'plugin-panel-installed');
  });

  it('passes onClose to child components', () => {
    render(<PluginModal isOpen={true} onClose={mockOnClose} />);

    const closeFromMarketplace = screen.getByText('Close from Marketplace');
    fireEvent.click(closeFromMarketplace);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
