import { renderHook, waitFor } from '@testing-library/react';
import { useAgents } from '../useAgents';

describe('useAgents', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches agents successfully', async () => {
    const mockAgents = [
      {
        id: 'code-reviewer',
        name: 'Code Reviewer',
        description: 'Reviews code for quality',
        model: 'sonnet',
        soulContent: '# Code Reviewer\n...',
        dirPath: '/path/to/agents/code-reviewer',
      },
      {
        id: 'planner',
        name: 'Planner',
        description: 'Creates implementation plans',
        soulContent: '# Planner\n...',
        dirPath: '/path/to/agents/planner',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agents: mockAgents,
      }),
    });

    const { result } = renderHook(() => useAgents());

    expect(result.current.loading).toBe(true);
    expect(result.current.agents).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual(mockAgents);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toContain('Failed to load agents');
  });

  it('handles network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toContain('Network error');
  });

  it('refetches agents when refetch is called', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        soulContent: '# Test\n...',
        dirPath: '/path/to/agents/test',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: mockAgents,
      }),
    });

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await result.current.refetch();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles empty agents list', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agents: [],
      }),
    });

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
