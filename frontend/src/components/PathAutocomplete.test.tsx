import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PathAutocomplete } from './PathAutocomplete';

interface PathEntry {
  name: string;
  path: string;
  isDir: boolean;
}

describe('PathAutocomplete', () => {
  const mockOnSelect = jest.fn();
  const mockOnClose = jest.fn();
  const mockInputRef = { current: null } as unknown as React.RefObject<HTMLTextAreaElement>;

  const mockEntries: PathEntry[] = [
    { name: 'src', path: '/project/src', isDir: true },
    { name: 'components', path: '/project/src/components', isDir: true },
    { name: 'App.tsx', path: '/project/src/App.tsx', isDir: false },
    { name: 'index.ts', path: '/project/src/index.ts', isDir: false },
  ];

  beforeEach(() => {
    mockOnSelect.mockClear();
    mockOnClose.mockClear();
  });

  it('renders nothing when entries array is empty', () => {
    const { container } = render(
      <PathAutocomplete
        entries={[]}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders path entries with correct names', () => {
    render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('components')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('displays folder icon for directories', () => {
    const { container } = render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const folderIcons = container.querySelectorAll('svg path[d*="22 19"]');
    expect(folderIcons.length).toBeGreaterThan(0);
  });

  it('displays file icon for files', () => {
    const { container } = render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const fileIcons = container.querySelectorAll('svg polyline');
    expect(fileIcons.length).toBeGreaterThan(0);
  });

  it('highlights selected item with correct class', () => {
    const { container } = render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={1}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const items = container.querySelectorAll('.path-autocomplete-item');
    expect(items[1]).toHaveClass('selected');
    expect(items[0]).not.toHaveClass('selected');
    expect(items[2]).not.toHaveClass('selected');
  });

  it('calls onSelect when clicking an entry', () => {
    render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const srcEntry = screen.getByText('src').closest('.path-autocomplete-item');
    fireEvent.click(srcEntry!);

    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith(mockEntries[0]);
  });

  it('renders with correct aria attributes', () => {
    render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={1}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const listbox = screen.getByRole('listbox', { name: 'Path suggestions' });
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('displays keyboard shortcuts in footer', () => {
    render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const footer = document.querySelector('.path-autocomplete-footer');
    expect(footer).toBeInTheDocument();
    expect(footer?.textContent).toContain('↑');
    expect(footer?.textContent).toContain('↓');
    expect(footer?.textContent).toContain('navigate');
    expect(footer?.textContent).toContain('Tab');
    expect(footer?.textContent).toContain('select');
    expect(footer?.textContent).toContain('Esc');
    expect(footer?.textContent).toContain('close');
  });

  it('positions element with default coordinates when inputRef is null', () => {
    const { container } = render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const element = container.querySelector('.path-autocomplete');
    expect(element).toHaveStyle({ top: '0px', left: '0px' });
  });

  it('handles click on different entries correctly', () => {
    render(
      <PathAutocomplete
        entries={mockEntries}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    const appTsxEntry = screen.getByText('App.tsx').closest('.path-autocomplete-item');
    fireEvent.click(appTsxEntry!);

    expect(mockOnSelect).toHaveBeenCalledWith(mockEntries[2]);
  });

  it('renders single entry correctly', () => {
    const singleEntry = [{ name: 'test.ts', path: '/test.ts', isDir: false }];

    render(
      <PathAutocomplete
        entries={singleEntry}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        inputRef={mockInputRef}
      />
    );

    expect(screen.getByText('test.ts')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
  });

  it('handles selectedIndex beyond entries length gracefully', () => {
    render(
      <PathAutocomplete
        entries={mockEntries}
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
      <PathAutocomplete
        entries={mockEntries}
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
});
