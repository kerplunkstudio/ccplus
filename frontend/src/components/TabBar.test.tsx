import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TabBar from './TabBar';
import { TabState } from '../types';

const mockTabs: TabState[] = [
  {
    sessionId: 'session1',
    label: 'First Session',
    isStreaming: false,
    hasRunningAgent: false,
    createdAt: Date.now(),
    type: 'chat',
  },
  {
    sessionId: 'session2',
    label: 'Second Session',
    isStreaming: false,
    hasRunningAgent: false,
    createdAt: Date.now(),
    type: 'chat',
  },
];

describe('TabBar', () => {
  const defaultProps = {
    tabs: mockTabs,
    activeTabId: 'session1',
    onSelectTab: jest.fn(),
    onNewTab: jest.fn(),
    onCloseTab: jest.fn(),
    onReopenTab: jest.fn(),
    onCloseOtherTabs: jest.fn(),
    onDuplicateTab: jest.fn(),
    onRenameTab: jest.fn(),
    hasClosedTabs: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.getByText('First Session')).toBeInTheDocument();
    expect(screen.getByText('Second Session')).toBeInTheDocument();
  });

  it('calls onSelectTab on single click', () => {
    render(<TabBar {...defaultProps} />);
    const tab = screen.getByText('Second Session');
    fireEvent.click(tab);
    expect(defaultProps.onSelectTab).toHaveBeenCalledWith('session2');
  });

  it('enters edit mode on double-click of active tab', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Double-click the active tab
    fireEvent.dblClick(tab);

    // Should show input with current label
    await waitFor(() => {
      const input = screen.getByDisplayValue('First Session');
      expect(input).toBeInTheDocument();
      expect(input).toHaveFocus();
    });
  });

  it('commits rename on Enter key', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Double-click to enter edit mode
    fireEvent.dblClick(tab);

    const input = await screen.findByDisplayValue('First Session');

    // Change the value
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed Session');

    // Press Enter
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Should call onRenameTab with new label
    await waitFor(() => {
      expect(defaultProps.onRenameTab).toHaveBeenCalledWith('session1', 'Renamed Session');
    });
  });

  it('commits rename on blur', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Double-click to enter edit mode
    fireEvent.dblClick(tab);

    const input = await screen.findByDisplayValue('First Session');

    // Change the value
    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');

    // Blur the input
    fireEvent.blur(input);

    // Should call onRenameTab
    await waitFor(() => {
      expect(defaultProps.onRenameTab).toHaveBeenCalledWith('session1', 'New Name');
    });
  });

  it('cancels rename on Escape key', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Double-click to enter edit mode
    fireEvent.dblClick(tab);

    const input = await screen.findByDisplayValue('First Session');

    // Change the value
    await userEvent.clear(input);
    await userEvent.type(input, 'Should Not Save');

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    // Should not call onRenameTab
    expect(defaultProps.onRenameTab).not.toHaveBeenCalled();

    // Should exit edit mode
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Should Not Save')).not.toBeInTheDocument();
    });
  });

  it('does not enter edit mode on double-click of inactive tab', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('Second Session');

    // Double-click inactive tab
    fireEvent.dblClick(tab);

    // Should not show input (should just select the tab twice)
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
    expect(defaultProps.onSelectTab).toHaveBeenCalled();
  });

  it('does not rename with empty value', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Double-click to enter edit mode
    fireEvent.dblClick(tab);

    const input = await screen.findByDisplayValue('First Session');

    // Clear the value
    await userEvent.clear(input);

    // Press Enter with empty value
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Should not call onRenameTab with empty string
    await waitFor(() => {
      expect(defaultProps.onRenameTab).not.toHaveBeenCalledWith('session1', '');
    });
  });

  it('trims whitespace from rename value', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Double-click to enter edit mode
    fireEvent.dblClick(tab);

    const input = await screen.findByDisplayValue('First Session');

    // Change the value with leading/trailing spaces
    await userEvent.clear(input);
    await userEvent.type(input, '  Trimmed Name  ');

    // Press Enter
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Should call onRenameTab with trimmed value
    await waitFor(() => {
      expect(defaultProps.onRenameTab).toHaveBeenCalledWith('session1', 'Trimmed Name');
    });
  });

  it('auto-selects input text when entering edit mode', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Double-click to enter edit mode
    fireEvent.dblClick(tab);

    const input = (await screen.findByDisplayValue('First Session')) as HTMLInputElement;

    // Check that text is selected
    await waitFor(() => {
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('First Session'.length);
    });
  });

  it('hides close button when in edit mode', async () => {
    render(<TabBar {...defaultProps} />);

    const tabItem = screen.getByText('First Session').closest('.tab-item');
    expect(tabItem).toBeInTheDocument();

    // Check close button exists initially (when hovering)
    if (tabItem) {
      fireEvent.mouseEnter(tabItem);
      const closeButton = screen.getByLabelText('Close tab');
      expect(closeButton).toBeInTheDocument();
    }

    // Double-click to enter edit mode
    fireEvent.dblClick(screen.getByText('First Session'));

    // Close button should be hidden during edit
    await waitFor(() => {
      expect(screen.queryByLabelText('Close tab')).not.toBeInTheDocument();
    });
  });
});
