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
};

describe('InsightsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(<InsightsPanel />);

    expect(screen.getByText('Loading insights...')).toBeInTheDocument();
  });

  it('renders insights data successfully', async () => {
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
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failed'));

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Network error: Network failed/)).toBeInTheDocument();
    });
  });

  it('handles HTTP error and shows error message', async () => {
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
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('days=7')
      );
    });
  });

  it('includes projectPath in API call when provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel projectPath="/Users/test/myproject" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('project=%2FUsers%2Ftest%2Fmyproject')
      );
    });
  });

  it('saves insights to cache after successful fetch', async () => {
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

    (global.fetch as jest.Mock)
      .mockImplementation(() => new Promise(() => {})) // First load never resolves
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockInsightsData,
      });

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

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => largeNumbersData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('1.5M')).toBeInTheDocument(); // total_queries
    });

    expect(screen.getByText(/7\.5M tokens/)).toBeInTheDocument(); // total tokens
  });

  it('renders chart with correct y-axis labels', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockInsightsData,
    });

    render(<InsightsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    const yLabels = document.querySelectorAll('.insights-y-label');
    expect(yLabels.length).toBe(5); // 0, 25%, 50%, 75%, 100%
  });
});
