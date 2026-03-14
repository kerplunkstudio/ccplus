import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProjectSidebar from './ProjectSidebar';
import { ProjectEntry } from '../types';

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

  it('toggles project expansion on click', () => {
    render(<ProjectSidebar {...defaultProps} />);
    const project2Header = screen.getByText('Project 2');

    // Initially collapsed
    expect(screen.queryByText('Third session')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(project2Header);
    expect(screen.getByText('Third session')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(project2Header);
    expect(screen.queryByText('Third session')).not.toBeInTheDocument();
  });

  it('toggles expansion on Enter key', () => {
    render(<ProjectSidebar {...defaultProps} />);
    const project2Header = screen.getByText('Project 2').closest('[role="button"]');

    // Initially collapsed
    expect(screen.queryByText('Third session')).not.toBeInTheDocument();

    // Press Enter to expand
    fireEvent.keyDown(project2Header!, { key: 'Enter' });
    expect(screen.getByText('Third session')).toBeInTheDocument();
  });

  it('highlights active session', async () => {
    render(<ProjectSidebar {...defaultProps} />);
    await waitFor(() => {
      const activeSession = screen.getByText('First session').closest('.session-item');
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
      const streamingSession = screen.getByText('Second session').closest('.session-item');
      expect(streamingSession?.querySelector('.session-activity-dot')).toBeInTheDocument();
    });
  });

  it('shows activity dot for sessions with running agents', () => {
    render(<ProjectSidebar {...defaultProps} />);
    const project2Header = screen.getByText('Project 2');
    fireEvent.click(project2Header);

    const runningSession = screen.getByText('Third session').closest('.session-item');
    expect(runningSession?.querySelector('.session-activity-dot')).toBeInTheDocument();
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
    render(<ProjectSidebar {...defaultProps} />);

    // Initially, project 2 is collapsed
    expect(screen.queryByText('Third session')).not.toBeInTheDocument();

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

    const project1Header = screen.getByText('Project 1').closest('.project-header');
    fireEvent.mouseEnter(project1Header!);

    await waitFor(() => {
      const newButton = screen.getByLabelText('New session');
      fireEvent.click(newButton);
      expect(defaultProps.onNewTabForProject).toHaveBeenCalledWith('/test/project1');
    });
  });

  it('calls onRemoveProject when clicking X on project header', async () => {
    render(<ProjectSidebar {...defaultProps} />);

    const project1Header = screen.getByText('Project 1').closest('.project-header');
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
      const session = screen.getByText('First session').closest('.session-item');
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
    expect(screen.getByText('Open a project to start')).toBeInTheDocument();
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
    const widths = calls.map(call => call[0]);
    expect(Math.max(...widths)).toBeLessThanOrEqual(400);
  });
});
