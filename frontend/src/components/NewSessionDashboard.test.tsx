import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { NewSessionDashboard } from './NewSessionDashboard';
import { UsageStats } from '../types';

global.fetch = jest.fn();

const mockUsageStats: UsageStats = {
  totalSessions: 45,
  totalCost: 123.45,
  totalDuration: 7200000, // 2 hours
  totalInputTokens: 50000,
  totalOutputTokens: 30000,
  queryCount: 150,
  contextWindowSize: 200000,
  model: 'sonnet',
  linesOfCode: 15000,
};

const mockPastSessions = [
  {
    session_id: 'session_123',
    last_user_message: 'Add authentication to the API',
    last_activity: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
  },
  {
    session_id: 'session_456',
    last_user_message: 'Fix database migration',
    last_activity: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), // 5 hours ago
  },
  {
    session_id: 'session_789',
    last_user_message: 'Refactor user service',
    last_activity: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), // 2 days ago
  },
];

const mockGitContext = {
  branch: 'feature/new-ui',
  dirty_count: 5,
  commits: [
    { hash: 'abc123', message: 'Add new component', time_ago: '2h ago' },
    { hash: 'def456', message: 'Fix styling bug', time_ago: '5h ago' },
    { hash: 'ghi789', message: 'Update dependencies', time_ago: '1d ago' },
  ],
};

describe('NewSessionDashboard', () => {
  const mockOnLoadSession = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    // Mock profile to empty for predictable greeting
    localStorage.setItem('ccplus_profile_settings', JSON.stringify({ name: '', kindOfWork: 'Software Engineer', chatFont: 'system' }));
  });

  it('renders without crashing', () => {
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    // Should render greeting
    const greeting = document.querySelector('.greeting-text');
    expect(greeting).toBeInTheDocument();
  });

  it('renders greeting without name when profile name is empty', () => {
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    const greeting = document.querySelector('.greeting-text');
    expect(greeting).toBeInTheDocument();
    expect(greeting?.textContent).not.toContain(',');
  });

  it('renders greeting with name when profile has name', () => {
    localStorage.setItem('ccplus_profile_settings', JSON.stringify({ name: 'Alice', kindOfWork: 'Software Engineer', chatFont: 'system' }));

    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    const greeting = screen.getByText(/Alice/i);
    expect(greeting).toBeInTheDocument();
  });

  it('renders usage stats correctly', () => {
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    expect(screen.getByText('45')).toBeInTheDocument(); // totalSessions
    expect(screen.getByText('15.0k')).toBeInTheDocument(); // linesOfCode
    expect(screen.getByText('2h')).toBeInTheDocument(); // totalDuration
  });

  it('renders project name when projectPath is provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGitContext,
    });

    render(
      <NewSessionDashboard
        projectPath="/Users/test/my-project"
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument();
    });
  });

  it('fetches and displays git context', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGitContext,
    });

    render(
      <NewSessionDashboard
        projectPath="/Users/test/my-project"
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('feature/new-ui')).toBeInTheDocument();
    });

    expect(screen.getByText('5 dirty')).toBeInTheDocument();
  });

  it('displays recent commits when available', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGitContext,
    });

    render(
      <NewSessionDashboard
        projectPath="/Users/test/my-project"
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('RECENT COMMITS')).toBeInTheDocument();
    });

    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.getByText('Add new component')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('does not fetch git context when projectPath is null', () => {
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders past sessions collapsed by default', () => {
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={mockPastSessions}
        onLoadSession={mockOnLoadSession}
      />
    );

    expect(screen.getByText('3 recent sessions')).toBeInTheDocument();
    expect(screen.queryByText('Add authentication to the API')).not.toBeInTheDocument();
  });

  it('expands past sessions when toggle is clicked', async () => {
    
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={mockPastSessions}
        onLoadSession={mockOnLoadSession}
      />
    );

    const toggleButton = screen.getByText('3 recent sessions');
    fireEvent.click(toggleButton);

    expect(screen.getByText('Add authentication to the API')).toBeInTheDocument();
    expect(screen.getByText('Fix database migration')).toBeInTheDocument();
    expect(screen.getByText('Refactor user service')).toBeInTheDocument();
  });

  it('calls onLoadSession when session is clicked', async () => {
    
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={mockPastSessions}
        onLoadSession={mockOnLoadSession}
      />
    );

    const toggleButton = screen.getByText('3 recent sessions');
    fireEvent.click(toggleButton);

    const sessionButton = screen.getByText('Add authentication to the API');
    fireEvent.click(sessionButton);

    expect(mockOnLoadSession).toHaveBeenCalledWith('session_123');
  });

  it('formats time ago correctly for sessions', async () => {
    
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={mockPastSessions}
        onLoadSession={mockOnLoadSession}
      />
    );

    const toggleButton = screen.getByText('3 recent sessions');
    fireEvent.click(toggleButton);

    expect(screen.getByText('30m ago')).toBeInTheDocument();
    expect(screen.getByText('5h ago')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('does not render sessions section when no past sessions', () => {
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    expect(screen.queryByText(/recent session/i)).not.toBeInTheDocument();
  });

  it('truncates long session messages', async () => {
    const longMessageSessions = [
      {
        session_id: 'session_long',
        last_user_message: 'This is a very long session message that should be truncated when displayed in the UI',
        last_activity: new Date().toISOString(),
      },
    ];

    
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={longMessageSessions}
        onLoadSession={mockOnLoadSession}
      />
    );

    const toggleButton = screen.getByText('1 recent session');
    fireEvent.click(toggleButton);

    const sessionLabel = screen.getByText(/This is a very long session message/);
    expect(sessionLabel.textContent).toContain('...');
    expect(sessionLabel.textContent!.length).toBeLessThan(100);
  });

  it('handles sessions without last_user_message', async () => {
    const sessionsWithoutMessage = [
      {
        session_id: 'session_empty',
        last_user_message: null,
        last_activity: new Date().toISOString(),
      },
    ];

    
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={sessionsWithoutMessage}
        onLoadSession={mockOnLoadSession}
      />
    );

    const toggleButton = screen.getByText('1 recent session');
    fireEvent.click(toggleButton);

    expect(screen.getByText('Untitled session')).toBeInTheDocument();
  });

  it('formats durations correctly', () => {
    const variousDurations: UsageStats = {
      totalSessions: 1,
      totalCost: 0,
      totalDuration: 125000, // 2m 5s
      totalInputTokens: 0,
      totalOutputTokens: 0,
      queryCount: 0,
      contextWindowSize: 200000,
      model: 'sonnet',
      linesOfCode: 0,
    };

    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={variousDurations}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    expect(screen.getByText('2m 5s')).toBeInTheDocument();
  });

  it('formats very short durations correctly', () => {
    const shortDuration: UsageStats = {
      totalSessions: 1,
      totalCost: 0,
      totalDuration: 500, // 500ms
      totalInputTokens: 0,
      totalOutputTokens: 0,
      queryCount: 0,
      contextWindowSize: 200000,
      model: 'sonnet',
      linesOfCode: 0,
    };

    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={shortDuration}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    expect(screen.getByText('500ms')).toBeInTheDocument();
  });

  it('shows clean indicator when no dirty files', async () => {
    const cleanGitContext = {
      ...mockGitContext,
      dirty_count: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => cleanGitContext,
    });

    render(
      <NewSessionDashboard
        projectPath="/Users/test/my-project"
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('feature/new-ui')).toBeInTheDocument();
    });

    expect(screen.queryByText(/dirty/)).not.toBeInTheDocument();
    const indicator = document.querySelector('.branch-indicator[data-clean="true"]');
    expect(indicator).toBeInTheDocument();
  });

  it('truncates long commit messages', async () => {
    const longCommitContext = {
      ...mockGitContext,
      commits: [
        {
          hash: 'abc123',
          message: 'This is a very long commit message that should be truncated in the UI to prevent overflow',
          time_ago: '2h ago',
        },
      ],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => longCommitContext,
    });

    render(
      <NewSessionDashboard
        projectPath="/Users/test/my-project"
        usageStats={mockUsageStats}
        pastSessions={[]}
        onLoadSession={mockOnLoadSession}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/This is a very long commit message/)).toBeInTheDocument();
    });

    const commitMessage = screen.getByText(/This is a very long commit message/);
    expect(commitMessage.textContent).toContain('...');
  });

  it('limits displayed sessions to 5', async () => {
    const manySessions = Array.from({ length: 10 }, (_, i) => ({
      session_id: `session_${i}`,
      last_user_message: `Session ${i}`,
      last_activity: new Date().toISOString(),
    }));

    
    render(
      <NewSessionDashboard
        projectPath={null}
        usageStats={mockUsageStats}
        pastSessions={manySessions}
        onLoadSession={mockOnLoadSession}
      />
    );

    const toggleButton = screen.getByText('10 recent sessions');
    fireEvent.click(toggleButton);

    // Only first 5 should be visible
    expect(screen.getByText('Session 0')).toBeInTheDocument();
    expect(screen.getByText('Session 4')).toBeInTheDocument();
    expect(screen.queryByText('Session 5')).not.toBeInTheDocument();
  });
});
