import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSelector } from './ModelSelector';

describe('ModelSelector', () => {
  const mockOnSelectModel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with the selected model label', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    expect(screen.getByText('Sonnet')).toBeInTheDocument();
  });

  it('shows the full model ID as title on trigger', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    expect(trigger).toHaveAttribute('title', 'claude-sonnet-4-20250514');
  });

  it('opens dropdown when trigger is clicked', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Opus')).toBeInTheDocument();
    expect(screen.getByText('Haiku')).toBeInTheDocument();
  });

  it('closes dropdown when clicking outside', async () => {
    render(
      <div>
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
        <button>Outside</button>
      </div>
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeInTheDocument();

    const outsideButton = screen.getByText('Outside');
    fireEvent.mouseDown(outsideButton);

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('calls onSelectModel when a model is selected', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    const opusOption = screen.getByText('Opus').closest('button');
    expect(opusOption).toBeInTheDocument();

    fireEvent.click(opusOption!);

    expect(mockOnSelectModel).toHaveBeenCalledWith('claude-opus-4-20250514');
  });

  it('closes dropdown after selecting a model', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    const haikuOption = screen.getByText('Haiku').closest('button');
    fireEvent.click(haikuOption!);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows overridden class when isOverridden is true', () => {
    render(
      <ModelSelector
        selectedModel="claude-opus-4-20250514"
        onSelectModel={mockOnSelectModel}
        sessionModel="claude-sonnet-4-20250514"
        isOverridden={true}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Opus \(session override\)/i });
    expect(trigger).toHaveClass('overridden');
  });

  it('shows session override info in title when overridden', () => {
    render(
      <ModelSelector
        selectedModel="claude-opus-4-20250514"
        onSelectModel={mockOnSelectModel}
        sessionModel="claude-sonnet-4-20250514"
        isOverridden={true}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Opus \(session override\)/i });
    expect(trigger).toHaveAttribute('title', 'Session: claude-opus-4-20250514\nDefault: claude-sonnet-4-20250514');
  });

  it('does not show overridden class when isOverridden is false', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
        isOverridden={false}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    expect(trigger).not.toHaveClass('overridden');
  });

  it('highlights the active model in the dropdown', () => {
    render(
      <ModelSelector
        selectedModel="claude-haiku-4-5-20251001"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Haiku/i });
    fireEvent.click(trigger);

    const haikuOption = screen.getByRole('option', { name: /Haiku/i });
    expect(haikuOption).toHaveClass('active');

    const sonnetOption = screen.getByRole('option', { name: /Sonnet/i });
    expect(sonnetOption).not.toHaveClass('active');
  });

  it('supports keyboard navigation (ArrowDown to open)', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('supports keyboard navigation (Escape to close)', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(trigger.parentElement!, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('supports keyboard navigation (Enter to select focused item)', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    // ArrowDown to focus next item (Opus)
    fireEvent.keyDown(trigger.parentElement!, { key: 'ArrowDown' });

    // Enter to select
    fireEvent.keyDown(trigger.parentElement!, { key: 'Enter' });

    expect(mockOnSelectModel).toHaveBeenCalledWith('claude-opus-4-20250514');
  });

  it('cycles through options with ArrowDown', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    const container = trigger.parentElement!;

    // Start focused on Sonnet (index 0)
    // Press ArrowDown -> Opus (index 1)
    fireEvent.keyDown(container, { key: 'ArrowDown' });

    const opusOption = screen.getByText('Opus').closest('button');
    expect(opusOption).toHaveClass('focused');
  });

  it('displays full model IDs in dropdown items', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/i });
    fireEvent.click(trigger);

    expect(screen.getByText('claude-sonnet-4-20250514')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-4-20250514')).toBeInTheDocument();
    expect(screen.getByText('claude-haiku-4-5-20251001')).toBeInTheDocument();
  });
});
