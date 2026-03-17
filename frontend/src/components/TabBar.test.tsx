import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TabBar from './TabBar';
import { TabState } from '../types';

describe('TabBar', () => {
  const mockTabs: TabState[] = [
    {
      sessionId: 'session_1',
      label: 'First Tab',
      isStreaming: false,
      hasRunningAgent: false,
      createdAt: Date.now(),
      type: 'chat',
    },
    {
      sessionId: 'session_2',
      label: 'Second Tab',
      isStreaming: false,
      hasRunningAgent: false,
      createdAt: Date.now(),
      type: 'chat',
    },
    {
      sessionId: 'session_3',
      label: 'Browser Tab',
      isStreaming: false,
      hasRunningAgent: false,
      createdAt: Date.now(),
      type: 'browser',
      url: 'https://example.com',
    },
  ];

  const defaultProps = {
    tabs: mockTabs,
    activeTabId: 'session_1',
    onSelectTab: jest.fn(),
    onNewTab: jest.fn(),
    onCloseTab: jest.fn(),
    onReopenTab: jest.fn(),
    onCloseOtherTabs: jest.fn(),
    onDuplicateTab: jest.fn(),
    hasClosedTabs: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the tab bar', () => {
      const { container } = render(<TabBar {...defaultProps} />);
      expect(container.querySelector('.tab-bar')).toBeInTheDocument();
    });

    it('renders all tabs', () => {
      render(<TabBar {...defaultProps} />);
      expect(screen.getByText('First Tab')).toBeInTheDocument();
      expect(screen.getByText('Second Tab')).toBeInTheDocument();
      expect(screen.getByText('Browser Tab')).toBeInTheDocument();
    });

    it('renders the new tab button', () => {
      render(<TabBar {...defaultProps} />);
      const newTabBtn = screen.getByRole('button', { name: 'New tab' });
      expect(newTabBtn).toBeInTheDocument();
      expect(newTabBtn).toHaveTextContent('+');
    });

    it('highlights the active tab', () => {
      const { container } = render(<TabBar {...defaultProps} />);
      const tabs = container.querySelectorAll('.tab-item');
      expect(tabs[0]).toHaveClass('active');
      expect(tabs[1]).not.toHaveClass('active');
    });

    it('renders browser icon for browser tabs', () => {
      const { container } = render(<TabBar {...defaultProps} />);
      const browserIcon = container.querySelector('.tab-item-icon');
      expect(browserIcon).toBeInTheDocument();
    });

    it('shows activity indicator when tab is streaming', () => {
      const streamingTabs: TabState[] = [
        {
          sessionId: 'session_1',
          label: 'Streaming Tab',
          isStreaming: true,
          hasRunningAgent: false,
          createdAt: Date.now(),
        },
      ];
      const { container } = render(<TabBar {...defaultProps} tabs={streamingTabs} />);
      expect(container.querySelector('.tab-item-dot')).toBeInTheDocument();
    });

    it('shows activity indicator when tab has running agent', () => {
      const runningTabs: TabState[] = [
        {
          sessionId: 'session_1',
          label: 'Running Tab',
          isStreaming: false,
          hasRunningAgent: true,
          createdAt: Date.now(),
        },
      ];
      const { container } = render(<TabBar {...defaultProps} tabs={runningTabs} />);
      expect(container.querySelector('.tab-item-dot')).toBeInTheDocument();
    });

    it('shows close button for inactive tabs', () => {
      render(<TabBar {...defaultProps} />);
      const tabs = screen.getAllByRole('button').filter(btn => btn.classList.contains('tab-item'));
      const inactiveTabs = tabs.slice(1, 3); // session_2 and session_3
      inactiveTabs.forEach(tab => {
        const closeBtn = tab.querySelector('.tab-item-close');
        expect(closeBtn).toBeInTheDocument();
      });
    });

    it('shows close button for active tab if not only tab', () => {
      render(<TabBar {...defaultProps} />);
      const tabs = screen.getAllByRole('button').filter(btn => btn.classList.contains('tab-item'));
      const activeTab = tabs[0];
      const closeBtn = activeTab.querySelector('.tab-item-close');
      expect(closeBtn).toBeInTheDocument();
    });

    it('does not show close button for active tab if it is the only tab', () => {
      const singleTab: TabState[] = [
        {
          sessionId: 'session_1',
          label: 'Only Tab',
          isStreaming: false,
          hasRunningAgent: false,
          createdAt: Date.now(),
        },
      ];
      render(<TabBar {...defaultProps} tabs={singleTab} />);
      const tab = screen.getByRole('button', { name: /Only Tab/ });
      const closeBtn = tab.querySelector('.tab-item-close');
      expect(closeBtn).not.toBeInTheDocument();
    });
  });

  describe('Tab Interactions', () => {
    it('calls onSelectTab when clicking a tab', () => {
      render(<TabBar {...defaultProps} />);
      const secondTab = screen.getByText('Second Tab');
      fireEvent.click(secondTab);
      expect(defaultProps.onSelectTab).toHaveBeenCalledWith('session_2');
    });

    it('calls onCloseTab when clicking close button', () => {
      render(<TabBar {...defaultProps} />);
      const tabs = screen.getAllByRole('button').filter(btn => btn.classList.contains('tab-item'));
      const closeBtn = tabs[1].querySelector('.tab-item-close') as HTMLElement;
      fireEvent.click(closeBtn);
      expect(defaultProps.onCloseTab).toHaveBeenCalledWith('session_2');
    });

    it('prevents tab selection when clicking close button', () => {
      render(<TabBar {...defaultProps} />);
      const tabs = screen.getAllByRole('button').filter(btn => btn.classList.contains('tab-item'));
      const closeBtn = tabs[1].querySelector('.tab-item-close') as HTMLElement;
      fireEvent.click(closeBtn);
      expect(defaultProps.onSelectTab).not.toHaveBeenCalled();
    });

    it('calls onNewTab when clicking new tab button', () => {
      render(<TabBar {...defaultProps} />);
      const newTabBtn = screen.getByRole('button', { name: 'New tab' });
      fireEvent.click(newTabBtn);
      expect(defaultProps.onNewTab).toHaveBeenCalledTimes(1);
    });
  });

  describe('Context Menu', () => {
    it('shows context menu on right click', () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      expect(screen.getByText('Duplicate Tab')).toBeInTheDocument();
      expect(screen.getByText('Close Tab')).toBeInTheDocument();
      expect(screen.getByText('Reopen Closed Tab')).toBeInTheDocument();
      expect(screen.getByText('Close Other Tabs')).toBeInTheDocument();
    });

    it('positions context menu at cursor location', () => {
      const { container } = render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab, { clientX: 100, clientY: 200 });
      const menu = container.querySelector('.tab-context-menu') as HTMLElement;
      expect(menu).toHaveStyle({ left: '100px', top: '200px' });
    });

    it('calls onDuplicateTab when clicking Duplicate Tab', () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      fireEvent.click(screen.getByText('Duplicate Tab'));
      expect(defaultProps.onDuplicateTab).toHaveBeenCalledWith('session_1');
    });

    it('calls onCloseTab when clicking Close Tab in menu', () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      fireEvent.click(screen.getByText('Close Tab'));
      expect(defaultProps.onCloseTab).toHaveBeenCalledWith('session_1');
    });

    it('calls onReopenTab when clicking Reopen Closed Tab', () => {
      render(<TabBar {...defaultProps} hasClosedTabs={true} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      fireEvent.click(screen.getByText('Reopen Closed Tab'));
      expect(defaultProps.onReopenTab).toHaveBeenCalledTimes(1);
    });

    it('disables Reopen Closed Tab when no closed tabs', () => {
      render(<TabBar {...defaultProps} hasClosedTabs={false} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      const reopenBtn = screen.getByText('Reopen Closed Tab');
      expect(reopenBtn).toBeDisabled();
    });

    it('calls onCloseOtherTabs when clicking Close Other Tabs', () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      fireEvent.click(screen.getByText('Close Other Tabs'));
      expect(defaultProps.onCloseOtherTabs).toHaveBeenCalledWith('session_1');
    });

    it('disables Close Other Tabs when only one tab exists', () => {
      const singleTab: TabState[] = [
        {
          sessionId: 'session_1',
          label: 'Only Tab',
          isStreaming: false,
          hasRunningAgent: false,
          createdAt: Date.now(),
        },
      ];
      render(<TabBar {...defaultProps} tabs={singleTab} />);
      const tab = screen.getByText('Only Tab');
      fireEvent.contextMenu(tab);
      const closeOthersBtn = screen.getByText('Close Other Tabs');
      expect(closeOthersBtn).toBeDisabled();
    });

    it('closes context menu when clicking outside', async () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      expect(screen.getByText('Duplicate Tab')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByText('Duplicate Tab')).not.toBeInTheDocument();
      });
    });

    it('closes context menu when pressing Escape', async () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      expect(screen.getByText('Duplicate Tab')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByText('Duplicate Tab')).not.toBeInTheDocument();
      });
    });

    it('closes context menu when scrolling', async () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      expect(screen.getByText('Duplicate Tab')).toBeInTheDocument();

      fireEvent.scroll(document);

      await waitFor(() => {
        expect(screen.queryByText('Duplicate Tab')).not.toBeInTheDocument();
      });
    });

    it('closes context menu after menu action', async () => {
      render(<TabBar {...defaultProps} />);
      const firstTab = screen.getByText('First Tab');
      fireEvent.contextMenu(firstTab);
      expect(screen.getByText('Duplicate Tab')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Duplicate Tab'));

      await waitFor(() => {
        expect(screen.queryByText('Duplicate Tab')).not.toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('renders empty tab list gracefully', () => {
      render(<TabBar {...defaultProps} tabs={[]} />);
      expect(screen.getByRole('button', { name: 'New tab' })).toBeInTheDocument();
    });

    it('handles tab with long label', () => {
      const longLabelTab: TabState[] = [
        {
          sessionId: 'session_1',
          label: 'This is a very long tab label that should probably be truncated by CSS',
          isStreaming: false,
          hasRunningAgent: false,
          createdAt: Date.now(),
        },
      ];
      render(<TabBar {...defaultProps} tabs={longLabelTab} />);
      expect(screen.getByText('This is a very long tab label that should probably be truncated by CSS')).toBeInTheDocument();
    });

    it('handles tab with empty label', () => {
      const emptyLabelTab: TabState[] = [
        {
          sessionId: 'session_1',
          label: '',
          isStreaming: false,
          hasRunningAgent: false,
          createdAt: Date.now(),
        },
      ];
      render(<TabBar {...defaultProps} tabs={emptyLabelTab} />);
      const tab = screen.getAllByRole('button').filter(btn => btn.classList.contains('tab-item'))[0];
      expect(tab).toBeInTheDocument();
    });

    it('updates when activeTabId changes', () => {
      const { container, rerender } = render(<TabBar {...defaultProps} />);
      let tabs = container.querySelectorAll('.tab-item');
      expect(tabs[0]).toHaveClass('active');

      rerender(<TabBar {...defaultProps} activeTabId="session_2" />);
      tabs = container.querySelectorAll('.tab-item');
      expect(tabs[1]).toHaveClass('active');
    });

    it('does not show context menu if already closed', () => {
      render(<TabBar {...defaultProps} />);
      // Don't open context menu, just check it doesn't exist
      expect(screen.queryByText('Duplicate Tab')).not.toBeInTheDocument();
    });
  });
});
