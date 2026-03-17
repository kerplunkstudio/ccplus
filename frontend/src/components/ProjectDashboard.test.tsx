import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { ProjectDashboard } from './ProjectDashboard';

global.fetch = jest.fn();

const mockOverview = {
  name: 'ccplus',
  path: '/Users/test/ccplus',
  git: {
    branch: 'main',
    dirty_count: 3,
  },
  file_tree: ['src/', 'package.json'],
  file_count: 450,
  commit_count: 128,
  tech_stack: ['React', 'TypeScript', 'Node.js', 'SQLite'],
  languages: [
    { name: 'TypeScript', files: 35, percentage: 60 },
    { name: 'JavaScript', files: 10, percentage: 25 },
    { name: 'CSS', files: 8, percentage: 15 },
  ],
  claude_md: {
    exists: true,
    excerpt: 'Project-specific guidance for Claude Code agents.',
  },
  sessions: [
    {
      session_id: 'session_123',
      last_user_message: 'Add tests for components',
      last_activity: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
      message_count: 12,
    },
    {
      session_id: 'session_456',
      last_user_message: 'Fix database migration bug',
      last_activity: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
      message_count: 8,
    },
  ],
  stats: {
    total_sessions: 15,
    total_cost: 23.45,
    total_duration_ms: 3600000,
    total_tools: 450,
    lines_of_code: 12500,
  },
};

describe('ProjectDashboard', () => {
  const mockOnNewSession = jest.fn();
  const mockOnLoadSession = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    expect(screen.getByText('Loading project overview...')).toBeInTheDocument();
  });

  it('renders project overview successfully', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('ccplus')).toBeInTheDocument();
    });

    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('3 dirty')).toBeInTheDocument();
  });

  it('renders project info stats', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('450')).toBeInTheDocument(); // files
    });

    expect(screen.getByText('128')).toBeInTheDocument(); // commits
    expect(screen.getByText('3')).toBeInTheDocument(); // languages
    expect(screen.getByText('15')).toBeInTheDocument(); // sessions
  });

  it('renders tech stack', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('React')).toBeInTheDocument();
    });

    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByText('SQLite')).toBeInTheDocument();
  });

  it('renders languages with percentages', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('60%')).toBeInTheDocument();
    });

    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
  });

  it('renders CLAUDE.md section when it exists', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('CLAUDE.MD')).toBeInTheDocument();
    });

    expect(screen.getByText('Project-specific guidance for Claude Code agents.')).toBeInTheDocument();
  });

  it('does not render CLAUDE.md section when it does not exist', async () => {
    const overviewWithoutClaudeMd = {
      ...mockOverview,
      claude_md: { exists: false, excerpt: null },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => overviewWithoutClaudeMd,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('ccplus')).toBeInTheDocument();
    });

    expect(screen.queryByText('CLAUDE.MD')).not.toBeInTheDocument();
  });

  it('renders recent sessions list', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('RECENT SESSIONS')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Add tests for components/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Fix database migration bug/)).toBeInTheDocument();
    expect(screen.getByText(/30m ago/)).toBeInTheDocument();
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
  });

  it('calls onLoadSession when session is clicked', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });


    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('RECENT SESSIONS')).toBeInTheDocument();
    });

    // Click the session item in the recent sessions list
    const sessions = screen.getAllByText(/Add tests for components/);
    const sessionButton = sessions[1].closest('button'); // Second occurrence (in recent sessions list)
    fireEvent.click(sessionButton!);

    expect(mockOnLoadSession).toHaveBeenCalledWith('session_123');
  });

  it('calls onNewSession when New session button is clicked', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    
    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('+ New session')).toBeInTheDocument();
    });

    const newSessionButton = screen.getByText('+ New session');
    fireEvent.click(newSessionButton);

    expect(mockOnNewSession).toHaveBeenCalled();
  });

  it('shows Resume button for most recent session', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Resume: "Add tests for components"/)).toBeInTheDocument();
    });
  });

  it('calls onLoadSession when Resume button is clicked', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    
    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Resume: "Add tests for components"/)).toBeInTheDocument();
    });

    const resumeButton = screen.getByText(/Resume: "Add tests for components"/);
    fireEvent.click(resumeButton);

    expect(mockOnLoadSession).toHaveBeenCalledWith('session_123');
  });

  it('shows empty state when no sessions', async () => {
    const overviewWithoutSessions = {
      ...mockOverview,
      sessions: [],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => overviewWithoutSessions,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    });

    expect(screen.getByText('Start a new session to begin coding')).toBeInTheDocument();
  });

  it('handles network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failed'));

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Network error: Network failed/)).toBeInTheDocument();
    });
  });

  it('handles HTTP error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'Server error' }),
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Server error/)).toBeInTheDocument();
    });
  });

  it('saves overview to cache after successful fetch', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('ccplus')).toBeInTheDocument();
    });

    const cached = localStorage.getItem('ccplus_dashboard_/Users/test/ccplus');
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached!).overview.name).toBe('ccplus');
  });

  it('loads from cache and shows stale indicator if cache is old', async () => {
    const oldCacheData = {
      overview: mockOverview,
      timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago (stale)
    };
    localStorage.setItem('ccplus_dashboard_/Users/test/ccplus', JSON.stringify(oldCacheData));

    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('ccplus')).toBeInTheDocument();
    });

    expect(screen.getByText(/Showing cached data/)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows clean indicator when no dirty files', async () => {
    const cleanOverview = {
      ...mockOverview,
      git: { branch: 'main', dirty_count: 0 },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => cleanOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument();
    });

    expect(screen.queryByText(/dirty/)).not.toBeInTheDocument();
    const indicator = document.querySelector('.dashboard-branch-indicator[data-clean="true"]');
    expect(indicator).toBeInTheDocument();
  });

  it('formats large numbers correctly', async () => {
    const largeNumbersOverview = {
      ...mockOverview,
      file_count: 12500,
      commit_count: 5400,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => largeNumbersOverview,
    });

    render(
      <ProjectDashboard
        projectPath="/Users/test/ccplus"
        projectName="ccplus"
        onNewSession={mockOnNewSession}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('12.5k')).toBeInTheDocument();
    });

    expect(screen.getByText('5.4k')).toBeInTheDocument();
  });
});
