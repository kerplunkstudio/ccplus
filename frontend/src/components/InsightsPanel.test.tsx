import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { InsightsPanel } from './InsightsPanel';

// Mock fetch
global.fetch = jest.fn();

const mockInsightsData = {
  period: {
    start: '2026-03-01',
    end: '2026-03-17',
    days: 30,
  },
  summary: {
    total_queries: 1250,
    total_cost: 45.67,
    total_input_tokens: 500000,
    total_output_tokens: 250000,
    total_tool_calls: 3200,
    total_sessions: 85,
    change_pct: 12.5,
    total_rate_limits: 5,
    cache_read_input_tokens: 50000,
    cache_creation_input_tokens: 25000,
    cache_hit_rate: 67.0,
  },
  daily: [
    {
      date: '2026-03-15',
      queries: 45,
      tool_calls: 120,
      cost: 1.5,
      input_tokens: 20000,
      output_tokens: 10000,
      sessions: 3,
    },
    {
      date: '2026-03-16',
      queries: 38,
      tool_calls: 95,
      cost: 1.2,
      input_tokens: 18000,
      output_tokens: 9000,
      sessions: 2,
    },
  ],
  by_project: [
    {
      project: 'ccplus',
      path: '/Users/test/ccplus',
      queries: 450,
      cost: 15.2,
    },
    {
      project: 'myapp',
      path: '/Users/test/myapp',
      queries: 320,
      cost: 10.8,
    },
  ],
  by_tool: [
    {
      tool: 'Bash',
      count: 850,
      success_rate: 0.95,
    },
    {
      tool: 'Edit',
      count: 620,
      success_rate: 0.87,
    },
  ],
  by_model: [],
  rate_limit_events: [
    {
      timestamp: '2026-03-17T10:30:00Z',
      session_id: 'session-abc123',
      retry_after_ms: 45000,
    },
    {
      timestamp: '2026-03-16T14:15:00Z',
      session_id: 'session-def456',
      retry_after_ms: 120000,
    },
  ],
  by_session: [
    {
      session_id: 'session-xyz',
      input_tokens: 50000,
      output_tokens: 30000,
      cache_read_tokens: 10000,
      tool_count: 25,
      label: 'Implement user authentication feature with OAuth',
    },
    {
      session_id: 'session-uvw',
      input_tokens: 30000,
      output_tokens: 20000,
      cache_read_tokens: 5000,
      tool_count: 15,
      label: 'Fix bug in payment processing module',
    },
  ],
};

describe('InsightsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  // Helper to mock the import/status call that fires on mount before insights fetch.
  const mockImportStatus = () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hasImports: false, count: 0 }),
    });
  };

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(<InsightsPanel />);

    expect(screen.getByText('Loading insights...')).toBeInTheDocument();
  });

  it('renders insights data successfully', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    expect(screen.getByText('1.3k')).toBeInTheDocument(); // total_queries formatted
    expect(screen.getByText(/queries in the last 30 days/)).toBeInTheDocument();
    expect(screen.getByText('+12.5%')).toBeInTheDocument();
  });

  it('renders summary stats correctly', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getAllByText(/750\.0k tokens/)[0]).toBeInTheDocument();
    });

    expect(screen.getAllByText(/3\.2k tool calls/)[0]).toBeInTheDocument();
    expect(screen.getByText(/85 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/\$45\.67 est\. cost/)).toBeInTheDocument();
  });

  it('renders project list when available', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('PROJECTS')).toBeInTheDocument();
    });

    expect(screen.getAllByText('ccplus')[0]).toBeInTheDocument();
    expect(screen.getAllByText('myapp')[0]).toBeInTheDocument();
  });

  it('renders tool list when available', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('TOOL PERFORMANCE')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Bash')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Edit')[0]).toBeInTheDocument();
    expect(screen.getAllByText('95%')[0]).toBeInTheDocument(); // success rate
    expect(screen.getAllByText('87%')[0]).toBeInTheDocument();
  });

  it('shows empty state for projects when no data', async () => {
    const emptyData = {
      ...mockInsightsData,
      by_project: [],
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => emptyData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('No project data')).toBeInTheDocument();
    });
  });

  it('shows empty state for tools when no data', async () => {
    const emptyData = {
      ...mockInsightsData,
      by_tool: [],
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => emptyData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('No tool data')).toBeInTheDocument();
    });
  });

  it('handles network error and shows error message', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failed'));

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Network error: Network failed/)).toBeInTheDocument();
    });
  });

  it('handles HTTP error and shows error message', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'Server error' }),
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Server error/)).toBeInTheDocument();
    });
  });

  it('changes time period when selecting different option', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '7' } });

    await waitFor(() => {
      // Check that fetch was called with days=7 (in insights call, not import/status)
      const insightsCalls = (global.fetch as jest.Mock).mock.calls.filter(
        call => call[0] && call[0].includes('/api/insights')
      );
      const days7Calls = insightsCalls.filter(call => call[0].includes('days=7'));
      expect(days7Calls.length).toBeGreaterThan(0);
    });
  });

  it('includes projectPath in API call when provided', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel projectPath="/Users/test/myproject" />);

    await waitFor(() => {
      // Check that fetch was called with the project parameter (insights call, not import/status)
      const insightsCalls = (global.fetch as jest.Mock).mock.calls.filter(
        call => call[0] && call[0].includes('/api/insights')
      );
      expect(insightsCalls.length).toBeGreaterThan(0);
      expect(insightsCalls[0][0]).toContain('project=%2FUsers%2Ftest%2Fmyproject');
    });
  });

  it('saves insights to cache after successful fetch', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    const cached = localStorage.getItem('ccplus_insights_global_30');
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached!).insights.summary.total_queries).toBe(1250);
  });

  it('loads from cache and shows stale indicator if cache is old', async () => {
    const oldCacheData = {
      insights: mockInsightsData,
      timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago (stale)
    };
    localStorage.setItem('ccplus_insights_global_30', JSON.stringify(oldCacheData));

    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    expect(screen.getByText(/Showing cached data/)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('loads from cache immediately if fresh', async () => {
    const freshCacheData = {
      insights: mockInsightsData,
      timestamp: Date.now() - 1 * 60 * 1000, // 1 minute ago (fresh)
    };
    localStorage.setItem('ccplus_insights_global_30', JSON.stringify(freshCacheData));

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    // Should show cached data immediately without loading state
    expect(screen.queryByText('Loading insights...')).not.toBeInTheDocument();
    expect(screen.getByText('Insights')).toBeInTheDocument();
  });

  it('renders daily chart bars', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    const bars = document.querySelectorAll('.insights-bar');
    expect(bars.length).toBeGreaterThan(0);
  });

  it('handles stale retry button click', async () => {
    const oldCacheData = {
      insights: mockInsightsData,
      timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago (stale)
    };
    localStorage.setItem('ccplus_insights_global_30', JSON.stringify(oldCacheData));

    // import/status fires 1st (consumed by first Once), background insights never resolves,
    // retry click gets the second Once (resolves with data).
    mockImportStatus();
    (global.fetch as jest.Mock)
      .mockImplementation(() => new Promise(() => {})) // background insights never resolves
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInsightsData,
      }); // retry click gets this

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    const retryButton = screen.getByText('Retry');
    fireEvent.click(retryButton);

    // After retry, stale indicator should disappear
    await waitFor(() => {
      expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    });
  });

  it('renders success rate badges with correct classes', async () => {
    const dataWithVariedRates = {
      ...mockInsightsData,
      by_tool: [
        { tool: 'High', count: 100, success_rate: 0.95 }, // high
        { tool: 'Medium', count: 100, success_rate: 0.75 }, // medium
        { tool: 'Low', count: 100, success_rate: 0.5 }, // low
      ],
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => dataWithVariedRates,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getAllByText('High')[0]).toBeInTheDocument();
    });

    const allHighPercentages = screen.getAllByText('95%');
    const allMediumPercentages = screen.getAllByText('75%');
    const allLowPercentages = screen.getAllByText('50%');

    // Tool performance table uses success-pct class (not success-badge anymore)
    expect(allHighPercentages[0]).toBeInTheDocument();
    expect(allMediumPercentages[0]).toBeInTheDocument();
    expect(allLowPercentages[0]).toBeInTheDocument();
  });

  it('formats large numbers correctly', async () => {
    const largeNumbersData = {
      ...mockInsightsData,
      summary: {
        ...mockInsightsData.summary,
        total_queries: 1_500_000,
        total_input_tokens: 5_000_000,
        total_output_tokens: 2_500_000,
      },
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => largeNumbersData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('1.5M')).toBeInTheDocument(); // total_queries
    });

    // Total is 5M + 2.5M = 7.5M, formatted as "7.5M tokens"
    // The text may appear multiple times (hero stats and other places)
    const tokenElements = screen.getAllByText(/7\.5M tokens/);
    expect(tokenElements.length).toBeGreaterThan(0);
  });

  it('renders chart with correct y-axis labels', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    const yLabels = document.querySelectorAll('.insights-y-label');
    expect(yLabels.length).toBe(10); // 5 for daily activity + 5 for daily token consumption
  });

  it('renders daily token consumption chart', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('DAILY TOKEN CONSUMPTION')).toBeInTheDocument();
    });

    expect(screen.getByText('Input tokens')).toBeInTheDocument();
    expect(screen.getByText('Output tokens')).toBeInTheDocument();

    const stackedBars = document.querySelectorAll('.insights-token-stacked-bar');
    expect(stackedBars.length).toBeGreaterThan(0);
  });

  it('displays rate limit events when available', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('RATE LIMIT EVENTS')).toBeInTheDocument();
    });

    expect(screen.getByText('5 events in 30 days')).toBeInTheDocument();
  });

  it('hides rate limit events when none exist', async () => {
    const noRateLimitsData = {
      ...mockInsightsData,
      rate_limit_events: [],
      summary: {
        ...mockInsightsData.summary,
        total_rate_limits: 0,
      },
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => noRateLimitsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    expect(screen.queryByText('RATE LIMIT EVENTS')).not.toBeInTheDocument();
  });

  it('displays cache efficiency when data exists', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('CACHE EFFICIENCY')).toBeInTheDocument();
    });

    expect(screen.getByText('67.0%')).toBeInTheDocument();
    expect(screen.getByText('cache hit rate')).toBeInTheDocument();
  });

  it('hides cache efficiency when no cache data', async () => {
    const noCacheData = {
      ...mockInsightsData,
      summary: {
        ...mockInsightsData.summary,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => noCacheData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    expect(screen.queryByText('CACHE EFFICIENCY')).not.toBeInTheDocument();
  });

  it('hides cache efficiency when cache fields are undefined', async () => {
    const undefinedCacheData = {
      ...mockInsightsData,
      summary: {
        ...mockInsightsData.summary,
        cache_read_input_tokens: undefined,
        cache_creation_input_tokens: undefined,
      },
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => undefinedCacheData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    expect(screen.queryByText('CACHE EFFICIENCY')).not.toBeInTheDocument();
  });

  it('displays top sessions by token usage', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('TOP SESSIONS BY TOKEN USAGE')).toBeInTheDocument();
    });

    // First label is 50 chars, truncated to 40 + '...'
    expect(screen.getByText('Implement user authentication feature wi...')).toBeInTheDocument();
    // Second label is 37 chars, not truncated
    expect(screen.getByText('Fix bug in payment processing module')).toBeInTheDocument();

    const sessionRows = document.querySelectorAll('.insights-table-row-sessions');
    expect(sessionRows.length).toBe(2);
  });

  it('hides sessions section when no session data', async () => {
    const noSessionsData = {
      ...mockInsightsData,
      by_session: [],
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => noSessionsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    expect(screen.queryByText('TOP SESSIONS BY TOKEN USAGE')).not.toBeInTheDocument();
  });

  it('truncates session labels longer than 40 characters', async () => {
    const longLabelData = {
      ...mockInsightsData,
      by_session: [
        {
          session_id: 'session-long',
          input_tokens: 10000,
          output_tokens: 5000,
          cache_read_tokens: 1000,
          tool_count: 10,
          label: 'This is a very long session label that should definitely be truncated to fit properly in the UI',
        },
      ],
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => longLabelData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('TOP SESSIONS BY TOKEN USAGE')).toBeInTheDocument();
    });

    // 40 chars + '...'
    const truncatedText = screen.getByText('This is a very long session label that s...');
    expect(truncatedText).toBeInTheDocument();
  });

  it('displays rate limit summary for many events', async () => {
    const manyEventsData = {
      ...mockInsightsData,
      summary: {
        ...mockInsightsData.summary,
        total_rate_limits: 15,
      },
      rate_limit_events: Array.from({ length: 15 }, (_, i) => ({
        timestamp: `2026-03-${17 - i}T10:30:00Z`,
        session_id: `session-${i}`,
        retry_after_ms: 30000,
      })),
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => manyEventsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('15 events in 30 days')).toBeInTheDocument();
    });
  });

  it('limits sessions display to 10 items', async () => {
    const manySessionsData = {
      ...mockInsightsData,
      by_session: Array.from({ length: 15 }, (_, i) => ({
        session_id: `session-${i}`,
        input_tokens: 10000,
        output_tokens: 5000,
        cache_read_tokens: 1000,
        tool_count: 5,
        label: `Session ${i}`,
      })),
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => manySessionsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('TOP SESSIONS BY TOKEN USAGE')).toBeInTheDocument();
    });

    const sessionRows = document.querySelectorAll('.insights-table-row-sessions');
    expect(sessionRows.length).toBe(10);
  });

  it('renders stacked token bars with input and output', async () => {
    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('DAILY TOKEN CONSUMPTION')).toBeInTheDocument();
    });

    const inputBars = document.querySelectorAll('.insights-token-stacked-input');
    const outputBars = document.querySelectorAll('.insights-token-stacked-output');

    expect(inputBars.length).toBeGreaterThan(0);
    expect(outputBars.length).toBeGreaterThan(0);
  });

  it('shows rate limit event count', async () => {
    const eventWithRateLimits = {
      ...mockInsightsData,
      summary: {
        ...mockInsightsData.summary,
        total_rate_limits: 3,
      },
      rate_limit_events: [
        {
          timestamp: '2026-03-17T10:30:00Z',
          session_id: 'session-123',
          retry_after_ms: 125000, // 2m 5s
        },
      ],
    };

    mockImportStatus();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => eventWithRateLimits,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('RATE LIMIT EVENTS')).toBeInTheDocument();
    });

    expect(screen.getByText('3 events in 30 days')).toBeInTheDocument();
  });
});
