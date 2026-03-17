import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelSelector } from './ModelSelector';

describe('ModelSelector', () => {
  const mockOnSelectModel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    expect(screen.getByRole('button', { name: /Model: Sonnet/ })).toBeInTheDocument();
  });

  it('displays the selected model label', () => {
    render(
      <ModelSelector
        selectedModel="claude-opus-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    expect(screen.getByText('Opus')).toBeInTheDocument();
  });

  it('opens dropdown when trigger button is clicked', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('displays all model options when open', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    fireEvent.click(trigger);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(screen.getByRole('option', { name: /Sonnet/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Opus/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Haiku/ })).toBeInTheDocument();
  });

  it('calls onSelectModel when option is clicked', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    fireEvent.click(trigger);

    const opusOption = screen.getByRole('option', { name: /Opus/ });
    fireEvent.click(opusOption);

    expect(mockOnSelectModel).toHaveBeenCalledWith('claude-opus-4-20250514');
  });

  it('closes dropdown after selecting an option', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    fireEvent.click(trigger);

    const haikuOption = screen.getByRole('option', { name: /Haiku/ });
    fireEvent.click(haikuOption);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes dropdown when clicking trigger again', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes dropdown when clicking outside', () => {
    render(
      <div>
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
        <div data-testid="outside">Outside element</div>
      </div>
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('marks the selected option as active', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    fireEvent.click(trigger);

    const sonnetOption = screen.getByRole('option', { name: /Sonnet/ });
    expect(sonnetOption).toHaveClass('active');
  });

  describe('keyboard navigation', () => {
    it('opens dropdown on ArrowDown when closed', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('opens dropdown on Enter when closed', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('opens dropdown on Space when closed', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: ' ' });

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('closes dropdown on Escape when open', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'Escape' });

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('navigates down through options with ArrowDown', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'ArrowDown' });

      const opusOption = screen.getByRole('option', { name: /Opus/ });
      expect(opusOption).toHaveClass('focused');
    });

    it('navigates up through options with ArrowUp', () => {
      render(
        <ModelSelector
          selectedModel="claude-opus-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Opus/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'ArrowUp' });

      const sonnetOption = screen.getByRole('option', { name: /Sonnet/ });
      expect(sonnetOption).toHaveClass('focused');
    });

    it('wraps to last option when ArrowUp at first option', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'ArrowUp' });

      const haikuOption = screen.getByRole('option', { name: /Haiku/ });
      expect(haikuOption).toHaveClass('focused');
    });

    it('wraps to first option when ArrowDown at last option', () => {
      render(
        <ModelSelector
          selectedModel="claude-haiku-4-5-20251001"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Haiku/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'ArrowDown' });

      const sonnetOption = screen.getByRole('option', { name: /Sonnet/ });
      expect(sonnetOption).toHaveClass('focused');
    });

    it('jumps to first option with Home key', () => {
      render(
        <ModelSelector
          selectedModel="claude-haiku-4-5-20251001"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Haiku/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'Home' });

      const sonnetOption = screen.getByRole('option', { name: /Sonnet/ });
      expect(sonnetOption).toHaveClass('focused');
    });

    it('jumps to last option with End key', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'End' });

      const haikuOption = screen.getByRole('option', { name: /Haiku/ });
      expect(haikuOption).toHaveClass('focused');
    });

    it('selects focused option on Enter', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'Enter' });

      expect(mockOnSelectModel).toHaveBeenCalledWith('claude-opus-4-20250514');
    });

    it('selects focused option on Space', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: ' ' });

      expect(mockOnSelectModel).toHaveBeenCalledWith('claude-haiku-4-5-20251001');
    });

    it('closes dropdown on Tab', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      fireEvent.keyDown(trigger, { key: 'Tab' });

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA attributes when closed', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).not.toHaveAttribute('aria-controls');
    });

    it('has proper ARIA attributes when open', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-controls', 'model-selector-listbox');
    });

    it('listbox has proper ARIA attributes', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveAttribute('aria-label', 'Select model');
      expect(listbox).toHaveAttribute('id', 'model-selector-listbox');
    });

    it('options have proper aria-selected attribute', () => {
      render(
        <ModelSelector
          selectedModel="claude-sonnet-4-20250514"
          onSelectModel={mockOnSelectModel}
        />
      );

      const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
      fireEvent.click(trigger);

      const sonnetOption = screen.getByRole('option', { name: /Sonnet/ });
      const opusOption = screen.getByRole('option', { name: /Opus/ });

      expect(sonnetOption).toHaveAttribute('aria-selected', 'true');
      expect(opusOption).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('handles unknown model ID gracefully', () => {
    render(
      <ModelSelector
        selectedModel="unknown-model"
        onSelectModel={mockOnSelectModel}
      />
    );

    expect(screen.getByText('unknown-model')).toBeInTheDocument();
  });

  it('displays full model ID in title attribute', () => {
    render(
      <ModelSelector
        selectedModel="claude-sonnet-4-20250514"
        onSelectModel={mockOnSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: /Model: Sonnet/ });
    expect(trigger).toHaveAttribute('title', 'claude-sonnet-4-20250514');
  });
});
