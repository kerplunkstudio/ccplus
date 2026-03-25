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
    isCaptainActive: false,
    onCaptainClick: jest.fn(),
    onSelectTab: jest.fn(),
    onNewTab: jest.fn(),
    onNewTerminalTab: jest.fn(),
    onCloseTab: jest.fn(),
    onReopenTab: jest.fn(),
    onCloseOtherTabs: jest.fn(),
    onDuplicateTab: jest.fn(),
    onRenameTab: jest.fn(),
    hasClosedTabs: false,
    pageTabsOpen: [] as string[],
    activePageTab: null as string | null,
    onSelectPageTab: jest.fn(),
    onClosePageTab: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<TabBar {...defaultProps} />);
    expect(screen.getByText('Captain')).toBeInTheDocument();
    expect(screen.getByText('First Session')).toBeInTheDocument();
    expect(screen.getByText('Second Session')).toBeInTheDocument();
  });

  it('renders Captain tab as first tab', () => {
    render(<TabBar {...defaultProps} />);
    const tabs = screen.getAllByRole('button');
    const captainTab = tabs.find(tab => tab.textContent?.includes('Captain'));
    expect(captainTab).toBeInTheDocument();
  });

  it('calls onCaptainClick when Captain tab is clicked', () => {
    render(<TabBar {...defaultProps} />);
    const captainTab = screen.getByText('Captain');
    fireEvent.click(captainTab);
    expect(defaultProps.onCaptainClick).toHaveBeenCalled();
  });

  it('shows Captain tab as active when isCaptainActive is true', () => {
    render(<TabBar {...defaultProps} isCaptainActive={true} />);
    const captainTab = screen.getByText('Captain').closest('.tab-item');
    expect(captainTab).toHaveClass('active');
  });

  it('Captain tab does not have a close button', () => {
    render(<TabBar {...defaultProps} />);
    const captainTab = screen.getByText('Captain').closest('.tab-item');
    const closeButton = captainTab?.querySelector('.tab-item-close');
    expect(closeButton).not.toBeInTheDocument();
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

    // Simulate double-click with two rapid click events (component detects double-click via timing)
    fireEvent.click(tab);
    fireEvent.click(tab);

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

    // Simulate double-click with two rapid click events
    fireEvent.click(tab);
    fireEvent.click(tab);

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

    // Simulate double-click with two rapid click events
    fireEvent.click(tab);
    fireEvent.click(tab);

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

    // Simulate double-click with two rapid click events
    fireEvent.click(tab);
    fireEvent.click(tab);

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

    // Simulate double-click with two rapid click events (inactive tab)
    fireEvent.click(tab);
    fireEvent.click(tab);

    // Should not show input (should just select the tab twice)
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
    expect(defaultProps.onSelectTab).toHaveBeenCalled();
  });

  it('does not rename with empty value', async () => {
    render(<TabBar {...defaultProps} />);

    const tab = screen.getByText('First Session');

    // Simulate double-click with two rapid click events
    fireEvent.click(tab);
    fireEvent.click(tab);

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

    // Simulate double-click with two rapid click events
    fireEvent.click(tab);
    fireEvent.click(tab);

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

    // Simulate double-click with two rapid click events
    fireEvent.click(tab);
    fireEvent.click(tab);

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

    // Check close button exists initially (there are 2 tabs, so 2 close buttons)
    const initialCloseButtons = screen.getAllByLabelText('Close tab');
    expect(initialCloseButtons.length).toBe(2);

    // Simulate double-click with two rapid click events to enter edit mode
    fireEvent.click(screen.getByText('First Session'));
    fireEvent.click(screen.getByText('First Session'));

    // During edit mode, there should be one less close button (only non-editing tabs have close buttons)
    await waitFor(() => {
      const closeButtons = screen.queryAllByLabelText('Close tab');
      expect(closeButtons.length).toBe(1);
    });
  });

  describe('Page Tabs', () => {
    it('renders page tabs when pageTabsOpen is provided', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['agents', 'mcp']} />);

      expect(screen.getByText('Agents')).toBeInTheDocument();
      expect(screen.getByText('MCP')).toBeInTheDocument();
    });

    it('renders page tabs between Captain and session tabs', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['insights']} />);

      const allTabs = screen.getAllByRole('button');
      const tabTexts = allTabs.map(tab => tab.textContent);

      // Captain should be first
      expect(tabTexts[0]).toContain('Captain');
      // Insights should come before session tabs
      const insightsIndex = tabTexts.findIndex(text => text?.includes('Insights'));
      const firstSessionIndex = tabTexts.findIndex(text => text?.includes('First Session'));
      expect(insightsIndex).toBeGreaterThan(0);
      expect(insightsIndex).toBeLessThan(firstSessionIndex);
    });

    it('shows active state for the currently active page tab', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['agents', 'mcp']} activePageTab="agents" />);

      const agentsTab = screen.getByText('Agents').closest('.tab-item');
      const mcpTab = screen.getByText('MCP').closest('.tab-item');

      expect(agentsTab).toHaveClass('active');
      expect(mcpTab).not.toHaveClass('active');
    });

    it('calls onSelectPageTab when page tab is clicked', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['settings']} />);

      const settingsTab = screen.getByText('Settings');
      fireEvent.click(settingsTab);

      expect(defaultProps.onSelectPageTab).toHaveBeenCalledWith('settings');
    });

    it('calls onClosePageTab when page tab close button is clicked', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['workflows']} />);

      const closeButton = screen.getByLabelText('Close Flows');
      fireEvent.click(closeButton);

      expect(defaultProps.onClosePageTab).toHaveBeenCalledWith('workflows');
    });

    it('renders correct icons and labels for all page types', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['agents', 'mcp', 'workflows', 'insights', 'settings', 'profile']} />);

      expect(screen.getByText('Agents')).toBeInTheDocument();
      expect(screen.getByText('MCP')).toBeInTheDocument();
      expect(screen.getByText('Flows')).toBeInTheDocument();
      expect(screen.getByText('Insights')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    it('page tabs always show close button (not hidden like session tabs)', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['agents']} />);

      const closeButton = screen.getByLabelText('Close Agents');
      expect(closeButton).toBeInTheDocument();
      // Close button should be visible even without hover (CSS handles opacity)
      expect(closeButton.className).toContain('tab-item-close');
    });

    it('does not show page tabs when pageTabsOpen is empty', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={[]} />);

      // Only Captain and session tabs should be present
      expect(screen.getByText('Captain')).toBeInTheDocument();
      expect(screen.getByText('First Session')).toBeInTheDocument();
      expect(screen.getByText('Second Session')).toBeInTheDocument();

      // Page tab labels should not be present
      expect(screen.queryByText('Agents')).not.toBeInTheDocument();
      expect(screen.queryByText('MCP')).not.toBeInTheDocument();
    });

    it('supports keyboard navigation for page tabs', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['profile']} />);

      const profileTab = screen.getByText('Profile').closest('.tab-item');
      expect(profileTab).toBeInTheDocument();

      fireEvent.keyDown(profileTab!, { key: 'Enter', code: 'Enter' });
      expect(defaultProps.onSelectPageTab).toHaveBeenCalledWith('profile');

      defaultProps.onSelectPageTab.mockClear();

      fireEvent.keyDown(profileTab!, { key: ' ', code: 'Space' });
      expect(defaultProps.onSelectPageTab).toHaveBeenCalledWith('profile');
    });

    it('page tab is not active when Captain is active', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['insights']} isCaptainActive={true} activePageTab={null} />);

      const insightsTab = screen.getByText('Insights').closest('.tab-item');
      expect(insightsTab).not.toHaveClass('active');
    });

    it('page tab is not active when a session tab is active', () => {
      render(<TabBar {...defaultProps} pageTabsOpen={['mcp']} activePageTab={null} activeTabId="session1" />);

      const mcpTab = screen.getByText('MCP').closest('.tab-item');
      expect(mcpTab).not.toHaveClass('active');
    });
  });
});
