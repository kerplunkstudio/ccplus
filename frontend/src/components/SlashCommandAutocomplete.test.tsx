import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandAutocomplete } from './SlashCommandAutocomplete';
import { SkillSuggestion } from '../utils/slashCommands';

describe('SlashCommandAutocomplete', () => {
  const mockOnSelect = jest.fn();
  const mockOnClose = jest.fn();
  const mockInputRef = { current: null } as React.RefObject<HTMLTextAreaElement>;

  const mockSuggestions: SkillSuggestion[] = [
    { name: 'commit', plugin: 'git-tools', description: 'Commit changes with a message' },
    { name: 'deploy', plugin: 'deploy-tools', description: 'Deploy to production' },
    { name: 'review-pr', plugin: 'github-tools', description: 'Review pull request' },
    { name: 'test', plugin: 'test-tools' },
  ];

  beforeEach(() => {
    mockOnSelect.mockClear();
    mockOnClose.mockClear();
  });

  it('renders nothing when suggestions array is empty', () => {
    const { container } = render(
      <SlashCommandAutocomplete
        suggestions={[]}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders slash command suggestions with names', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(screen.getByText('/commit')).toBeInTheDocument();
    expect(screen.getByText('/deploy')).toBeInTheDocument();
    expect(screen.getByText('/review-pr')).toBeInTheDocument();
    expect(screen.getByText('/test')).toBeInTheDocument();
  });

  it('renders plugin names for each suggestion', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(screen.getByText('git-tools')).toBeInTheDocument();
    expect(screen.getByText('deploy-tools')).toBeInTheDocument();
    expect(screen.getByText('github-tools')).toBeInTheDocument();
    expect(screen.getByText('test-tools')).toBeInTheDocument();
  });

  it('renders descriptions when available', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(screen.getByText('Commit changes with a message')).toBeInTheDocument();
    expect(screen.getByText('Deploy to production')).toBeInTheDocument();
    expect(screen.getByText('Review pull request')).toBeInTheDocument();
  });

  it('does not render description element when description is missing', () => {
    const { container } = render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const testItem = screen.getByText('/test').closest('.slash-autocomplete-item');
    const description = testItem?.querySelector('.slash-autocomplete-description');
    expect(description).toBeNull();
  });

  it('highlights selected item with correct class', () => {
    const { container } = render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={2}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const items = container.querySelectorAll('.slash-autocomplete-item');
    expect(items[2]).toHaveClass('selected');
    expect(items[0]).not.toHaveClass('selected');
    expect(items[1]).not.toHaveClass('selected');
    expect(items[3]).not.toHaveClass('selected');
  });

  it('calls onSelect when clicking a suggestion', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const deployItem = screen.getByText('/deploy').closest('.slash-autocomplete-item');
    fireEvent.click(deployItem!);

    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith(mockSuggestions[1]);
  });

  it('renders with correct aria attributes', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={1}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const listbox = screen.getByRole('listbox', { name: 'Slash command suggestions' });
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('displays keyboard shortcuts in footer', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const footer = document.querySelector('.slash-autocomplete-footer');
    expect(footer).toBeInTheDocument();
    expect(footer?.textContent).toContain('↑');
    expect(footer?.textContent).toContain('↓');
    expect(footer?.textContent).toContain('navigate');
    expect(footer?.textContent).toContain('↵');
    expect(footer?.textContent).toContain('Tab');
    expect(footer?.textContent).toContain('select');
    expect(footer?.textContent).toContain('Esc');
    expect(footer?.textContent).toContain('close');
  });

  it('positions element with default coordinates when inputRef is null', () => {
    const { container } = render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const element = container.querySelector('.slash-autocomplete');
    expect(element).toHaveStyle({ top: '0px', left: '0px' });
  });

  it('handles click on different suggestions correctly', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const reviewPrItem = screen.getByText('/review-pr').closest('.slash-autocomplete-item');
    fireEvent.click(reviewPrItem!);

    expect(mockOnSelect).toHaveBeenCalledWith(mockSuggestions[2]);
  });

  it('renders single suggestion correctly', () => {
    const singleSuggestion: SkillSuggestion[] = [
      { name: 'help', plugin: 'core', description: 'Show help' },
    ];

    render(
      <SlashCommandAutocomplete
        suggestions={singleSuggestion}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(screen.getByText('/help')).toBeInTheDocument();
    expect(screen.getByText('core')).toBeInTheDocument();
    expect(screen.getByText('Show help')).toBeInTheDocument();
  });

  it('handles selectedIndex beyond suggestions length gracefully', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={999}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const options = screen.getAllByRole('option');
    options.forEach((option) => {
      expect(option).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('handles negative selectedIndex gracefully', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={-1}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const options = screen.getAllByRole('option');
    options.forEach((option) => {
      expect(option).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('handles mouseEnter event without errors', () => {
    render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const item = screen.getByText('/commit').closest('.slash-autocomplete-item');
    // Should not throw error even though onMouseEnter does nothing
    fireEvent.mouseEnter(item!);

    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  it('uses unique keys for each suggestion', () => {
    const { container } = render(
      <SlashCommandAutocomplete
        suggestions={mockSuggestions}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const items = container.querySelectorAll('.slash-autocomplete-item');
    expect(items).toHaveLength(4);
  });
});
