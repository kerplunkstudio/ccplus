import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProjectSidebar from './ProjectSidebar';
import { ProjectEntry } from '../types';
import { ToastProvider } from '../contexts/ToastContext';

// Mock WorkspaceBrowser to avoid fetch calls
jest.mock('./WorkspaceBrowser', () => ({
  WorkspaceBrowser: () => null,
}));

const mockProjects: ProjectEntry[] = [
  {
    path: '/test/project1',
    name: 'Project 1',
    tabs: [
      {
        sessionId: 'session-1',
        label: 'First session',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
      },
      {
        sessionId: 'session-2',
        label: 'Second session',
        isStreaming: true,
        hasRunningAgent: false,
        createdAt: Date.now(),
      },
    ],
    activeTabId: 'session-1',
  },
  {
    path: '/test/project2',
    name: 'Project 2',
    tabs: [
      {
        sessionId: 'session-3',
        label: 'Third session',
        isStreaming: false,
        hasRunningAgent: true,
        createdAt: Date.now(),
      },
    ],
    activeTabId: 'session-3',
  },
];

const defaultProps = {
  projects: mockProjects,
  activeProjectPath: '/test/project1',
  activeTabId: 'session-1',
  onSelectProject: jest.fn(),
  onSelectTab: jest.fn(),
  onAddProject: jest.fn(),
  onRemoveProject: jest.fn(),
  onNewTabForProject: jest.fn(),
  onCloseTab: jest.fn(),
  onRenameTab: jest.fn(),
  sidebarWidth: 260,
  onSidebarWidthChange: jest.fn(),
  onNavigate: jest.fn(),
  activePage: null,
};

// Helper to wrap renders in ToastProvider
const renderWithToast = (ui: React.ReactElement) => {
  return render(<ToastProvider>{ui}</ToastProvider>);
};

describe('ProjectSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('renders project headers', () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);
    expect(screen.getByText('Project 1')).toBeInTheDocument();
    expect(screen.getByText('Project 2')).toBeInTheDocument();
  });

  it('auto-expands active project on mount', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('First session')).toBeInTheDocument();
    });
  });

  it('toggles project expansion on click', async () => {
    // Start with no active project so project 2 is not auto-expanded
    const props = {
      ...defaultProps,
      activeProjectPath: null,
      activeTabId: null,
    };
    renderWithToast(<ProjectSidebar {...props} />);

    await waitFor(() => {
      const project2Header = screen.getByText('Project 2');
      expect(project2Header).toBeInTheDocument();
    });

    const project2Header = screen.getByText('Project 2');
    const projectGroup = project2Header.closest('.sb-project-group');
    const sessionList = projectGroup?.querySelector('.sb-session-list');

    // Test that clicking toggles the expanded class
    const initiallyExpanded = sessionList?.classList.contains('expanded');

    fireEvent.click(project2Header);
    expect(sessionList?.classList.contains('expanded')).toBe(!initiallyExpanded);

    fireEvent.click(project2Header);
    expect(sessionList?.classList.contains('expanded')).toBe(initiallyExpanded);
  });

  it('toggles expansion on Enter key', async () => {
    // Start with no active project so project 2 is not auto-expanded
    const props = {
      ...defaultProps,
      activeProjectPath: null,
      activeTabId: null,
    };
    renderWithToast(<ProjectSidebar {...props} />);

    await waitFor(() => {
      const project2Header = screen.getByText('Project 2');
      expect(project2Header).toBeInTheDocument();
    });

    const project2Header = screen.getByText('Project 2').closest('[role="button"]');
    const projectGroup = project2Header?.closest('.sb-project-group');
    const sessionList = projectGroup?.querySelector('.sb-session-list');

    const initiallyExpanded = sessionList?.classList.contains('expanded');

    // Press Enter to toggle
    fireEvent.keyDown(project2Header!, { key: 'Enter' });
    expect(sessionList?.classList.contains('expanded')).toBe(!initiallyExpanded);
  });

  it('highlights active session', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      const activeSession = screen.getByText('First session').closest('.sb-session-item');
      expect(activeSession).toHaveClass('active');
    });
  });

  it('calls onSelectTab when clicking a session', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      const session = screen.getByText('Second session');
      fireEvent.click(session);
      expect(defaultProps.onSelectTab).toHaveBeenCalledWith('/test/project1', 'session-2');
    });
  });

  it('shows activity dot for streaming sessions', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      const streamingSession = screen.getByText('Second session').closest('.sb-session-item');
      expect(streamingSession?.querySelector('.sb-session-dot')).toBeInTheDocument();
    });
  });

  it('shows activity dot for sessions with running agents', () => {
    // Expand project 2 by clicking it
    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const project2Header = screen.getByText('Project 2');
    fireEvent.click(project2Header);

    const runningSession = screen.getByText('Third session').closest('.sb-session-item');
    expect(runningSession?.querySelector('.sb-session-dot')).toBeInTheDocument();
  });

  it('filters sessions by search query', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search sessions...');
    fireEvent.change(searchInput, { target: { value: 'First' } });

    await waitFor(() => {
      expect(screen.getByText('First session')).toBeInTheDocument();
      expect(screen.queryByText('Second session')).not.toBeInTheDocument();
      expect(screen.queryByText('Third session')).not.toBeInTheDocument();
    });
  });

  it('auto-expands all projects when searching', async () => {
    // Start with no active project so project 2 is not auto-expanded
    const props = {
      ...defaultProps,
      activeProjectPath: null,
      activeTabId: null,
    };
    renderWithToast(<ProjectSidebar {...props} />);

    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText('Search sessions...');
      expect(searchInput).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search sessions...');
    fireEvent.change(searchInput, { target: { value: 'Third' } });

    await waitFor(() => {
      expect(screen.getByText('Third session')).toBeInTheDocument();
    });
  });

  it('clears search query when clicking X button', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search sessions...');
    fireEvent.change(searchInput, { target: { value: 'test' } });

    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton);

    expect(searchInput).toHaveValue('');
  });

  it('calls onNewTabForProject when clicking + button', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    const project1Header = screen.getByText('Project 1').closest('.sb-project-header');
    fireEvent.mouseEnter(project1Header!);

    await waitFor(() => {
      const newButtons = screen.getAllByLabelText('New session');
      // Click the first one (for Project 1)
      fireEvent.click(newButtons[0]);
      expect(defaultProps.onNewTabForProject).toHaveBeenCalledWith('/test/project1');
    });
  });

  it('calls onRemoveProject when clicking X on project header', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    const project1Header = screen.getByText('Project 1').closest('.sb-project-header');
    fireEvent.mouseEnter(project1Header!);

    await waitFor(() => {
      const closeButton = screen.getByLabelText('Close Project 1');
      fireEvent.click(closeButton);
      expect(defaultProps.onRemoveProject).toHaveBeenCalledWith('/test/project1');
    });
  });

  it('calls onCloseTab when clicking X on session', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    await waitFor(() => {
      const session = screen.getByText('First session').closest('.sb-session-item');
      fireEvent.mouseEnter(session!);
    });

    await waitFor(() => {
      const closeButton = screen.getByLabelText('Close First session');
      fireEvent.click(closeButton);
      expect(defaultProps.onCloseTab).toHaveBeenCalledWith('/test/project1', 'session-1');
    });
  });

  it('persists expanded state to localStorage', () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    const project2Header = screen.getByText('Project 2');
    fireEvent.click(project2Header);

    const stored = localStorage.getItem('ccplus_sidebar_expanded');
    expect(stored).toBeTruthy();
    const expanded = JSON.parse(stored!);
    expect(expanded).toContain('/test/project2');
  });

  it('shows empty state when no projects', () => {
    renderWithToast(<ProjectSidebar {...defaultProps} projects={[]} />);
    expect(screen.getByText('No projects open')).toBeInTheDocument();
  });

  it('handles resize on drag', () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    const handle = screen.getByLabelText('Resize sidebar');
    fireEvent.mouseDown(handle, { clientX: 260 });

    fireEvent.mouseMove(document, { clientX: 300 });
    expect(defaultProps.onSidebarWidthChange).toHaveBeenCalled();

    fireEvent.mouseUp(document);
  });

  it('clamps resize width between min and max', () => {
    renderWithToast(<ProjectSidebar {...defaultProps} sidebarWidth={200} />);

    const handle = screen.getByLabelText('Resize sidebar');
    fireEvent.mouseDown(handle, { clientX: 200 });

    // Try to drag beyond max
    fireEvent.mouseMove(document, { clientX: 600 });

    // Should clamp to MAX_WIDTH (400)
    const calls = defaultProps.onSidebarWidthChange.mock.calls;
    const widths = calls.map((call: any) => call[0]);
    expect(Math.max(...widths)).toBeLessThanOrEqual(400);
  });
});

describe('ProjectSidebar Search Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('debounces search API call', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 't' } });
    fireEvent.change(searchInput, { target: { value: 'te' } });
    fireEvent.change(searchInput, { target: { value: 'test' } });

    // Should not call immediately
    expect(global.fetch).not.toHaveBeenCalled();

    // Wait for debounce (300ms)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    }, { timeout: 500 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search?q=test')
    );
  });

  it('displays search results from API', async () => {
    const mockResults = [
      {
        session_id: 'session-1',
        session_label: 'First session',
        matches: [
          {
            content: 'This is a test message with search term',
            role: 'user',
            timestamp: '2024-01-01T12:00:00',
          },
        ],
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(/1 results across 1 sessions/i)).toBeInTheDocument();
    });

    expect(screen.getByText('First session')).toBeInTheDocument();
    // Text is split by highlightMatch function into mark/span elements
    expect(screen.getByText((content, element) => {
      return element?.textContent === 'This is a test message with search term';
    })).toBeInTheDocument();
  });

  it('highlights search term in results', async () => {
    const mockResults = [
      {
        session_id: 'session-1',
        session_label: 'Test Session',
        matches: [
          {
            content: 'This contains the search word',
            role: 'user',
            timestamp: '2024-01-01T12:00:00',
          },
        ],
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 'search' } });

    await waitFor(() => {
      const highlighted = document.querySelector('.search-highlight');
      expect(highlighted).toBeInTheDocument();
      expect(highlighted?.textContent).toBe('search');
    });
  });

  it('shows empty state when no API results', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    await waitFor(() => {
      expect(screen.getByText(/No results for 'nonexistent'/i)).toBeInTheDocument();
    });
  });

  it('calls onSelectTab when search result clicked', async () => {
    const mockResults = [
      {
        session_id: 'session-2',
        session_label: 'Second session',
        matches: [
          {
            content: 'Implementing search',
            role: 'user',
            timestamp: '2024-01-01T12:00:00',
          },
        ],
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 'search' } });

    await waitFor(() => {
      const contentElement = screen.getByText((content, element) => {
        return element?.textContent === 'Implementing search';
      });
      expect(contentElement).toBeInTheDocument();
    });

    // Find the result item by its class since text is split across elements
    const resultItem = document.querySelector('.search-result-item');
    expect(resultItem).toBeInTheDocument();

    fireEvent.click(resultItem!);

    expect(defaultProps.onSelectProject).toHaveBeenCalledWith('/test/project1');
    expect(defaultProps.onSelectTab).toHaveBeenCalledWith('/test/project1', 'session-2');
  });

  it('returns to normal session list when search cleared', async () => {
    const mockResults = [
      {
        session_id: 'session-1',
        session_label: 'Test Session',
        matches: [
          {
            content: 'Test content',
            role: 'user',
            timestamp: '2024-01-01T12:00:00',
          },
        ],
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    // Perform search
    fireEvent.change(searchInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(/1 results across 1 sessions/i)).toBeInTheDocument();
    });

    // Clear search
    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.queryByText(/1 results across 1 sessions/i)).not.toBeInTheDocument();
    });

    // Normal session list should be visible
    expect(screen.getByText('Project 1')).toBeInTheDocument();
  });

  it('groups multiple matches from same session', async () => {
    const mockResults = [
      {
        session_id: 'session-1',
        session_label: 'Test Session',
        matches: [
          {
            content: 'First test message',
            role: 'user',
            timestamp: '2024-01-01T12:00:00',
          },
          {
            content: 'Second test message',
            role: 'assistant',
            timestamp: '2024-01-01T12:01:00',
          },
        ],
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockResults }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(/2 results across 1 sessions/i)).toBeInTheDocument();
    });

    // Text is split by highlightMatch function into mark/span elements
    expect(screen.getByText((content, element) => {
      return element?.textContent === 'First test message';
    })).toBeInTheDocument();
    expect(screen.getByText((content, element) => {
      return element?.textContent === 'Second test message';
    })).toBeInTheDocument();
  });

  it('handles search API errors gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    renderWithToast(<ProjectSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    }, { timeout: 500 });

    // Should show empty state
    await waitFor(() => {
      expect(screen.getByText(/No results for 'test'/i)).toBeInTheDocument();
    });
  });

  it('includes project path in search when active project selected', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    renderWithToast(<ProjectSidebar {...defaultProps} activeProjectPath="/test/project1" />);
    const searchInput = screen.getByPlaceholderText('Search sessions...');

    fireEvent.change(searchInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('project=%2Ftest%2Fproject1')
      );
    }, { timeout: 500 });
  });
});
