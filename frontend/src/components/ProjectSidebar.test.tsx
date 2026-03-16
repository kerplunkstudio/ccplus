import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProjectSidebar from './ProjectSidebar';
import { ProjectEntry } from '../types';

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
  sidebarWidth: 260,
  onSidebarWidthChange: jest.fn(),
  onNavigate: jest.fn(),
  activePage: null,
};

describe('ProjectSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('renders project headers', () => {
    render(<ProjectSidebar {...defaultProps} />);
    expect(screen.getByText('Project 1')).toBeInTheDocument();
    expect(screen.getByText('Project 2')).toBeInTheDocument();
  });

  it('auto-expands active project on mount', async () => {
    render(<ProjectSidebar {...defaultProps} />);
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
    render(<ProjectSidebar {...props} />);

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
    render(<ProjectSidebar {...props} />);

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
    render(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      const activeSession = screen.getByText('First session').closest('.sb-session-item');
      expect(activeSession).toHaveClass('active');
    });
  });

  it('calls onSelectTab when clicking a session', async () => {
    render(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      const session = screen.getByText('Second session');
      fireEvent.click(session);
      expect(defaultProps.onSelectTab).toHaveBeenCalledWith('/test/project1', 'session-2');
    });
  });

  it('shows activity dot for streaming sessions', async () => {
    render(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      const streamingSession = screen.getByText('Second session').closest('.sb-session-item');
      expect(streamingSession?.querySelector('.sb-session-dot')).toBeInTheDocument();
    });
  });

  it('shows activity dot for sessions with running agents', () => {
    // Expand project 2 by clicking it
    render(<ProjectSidebar {...defaultProps} />);
    const project2Header = screen.getByText('Project 2');
    fireEvent.click(project2Header);

    const runningSession = screen.getByText('Third session').closest('.sb-session-item');
    expect(runningSession?.querySelector('.sb-session-dot')).toBeInTheDocument();
  });

  it('filters sessions by search query', async () => {
    render(<ProjectSidebar {...defaultProps} />);

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
    render(<ProjectSidebar {...props} />);

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
    render(<ProjectSidebar {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search sessions...');
    fireEvent.change(searchInput, { target: { value: 'test' } });

    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton);

    expect(searchInput).toHaveValue('');
  });

  it('calls onNewTabForProject when clicking + button', async () => {
    render(<ProjectSidebar {...defaultProps} />);

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
    render(<ProjectSidebar {...defaultProps} />);

    const project1Header = screen.getByText('Project 1').closest('.sb-project-header');
    fireEvent.mouseEnter(project1Header!);

    await waitFor(() => {
      const closeButton = screen.getByLabelText('Close Project 1');
      fireEvent.click(closeButton);
      expect(defaultProps.onRemoveProject).toHaveBeenCalledWith('/test/project1');
    });
  });

  it('calls onCloseTab when clicking X on session', async () => {
    render(<ProjectSidebar {...defaultProps} />);

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
    render(<ProjectSidebar {...defaultProps} />);

    const project2Header = screen.getByText('Project 2');
    fireEvent.click(project2Header);

    const stored = localStorage.getItem('ccplus_sidebar_expanded');
    expect(stored).toBeTruthy();
    const expanded = JSON.parse(stored!);
    expect(expanded).toContain('/test/project2');
  });

  it('shows empty state when no projects', () => {
    render(<ProjectSidebar {...defaultProps} projects={[]} />);
    expect(screen.getByText('No projects open')).toBeInTheDocument();
  });

  it('handles resize on drag', () => {
    render(<ProjectSidebar {...defaultProps} />);

    const handle = screen.getByLabelText('Resize sidebar');
    fireEvent.mouseDown(handle, { clientX: 260 });

    fireEvent.mouseMove(document, { clientX: 300 });
    expect(defaultProps.onSidebarWidthChange).toHaveBeenCalled();

    fireEvent.mouseUp(document);
  });

  it('clamps resize width between min and max', () => {
    render(<ProjectSidebar {...defaultProps} sidebarWidth={200} />);

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
