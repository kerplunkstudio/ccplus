import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentsPanel } from '../AgentsPanel';

describe('AgentsPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<AgentsPanel />);

    expect(screen.getByText('Loading agents...')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load agents/)).toBeInTheDocument();
    });
  });

  it('renders empty state when no agents configured', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { agents: [] },
      }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('No agents configured')).toBeInTheDocument();
    });

    expect(screen.getByText(/Create/)).toBeInTheDocument();
  });

  it('renders agents list successfully', async () => {
    const mockAgents = [
      {
        id: 'code-reviewer',
        name: 'Code Reviewer',
        description: 'Reviews code for quality and security',
        model: 'sonnet',
        soulContent: '# Code Reviewer\nYou are a strict code reviewer...',
        dirPath: '/path/to/agents/code-reviewer',
        security: {
          allowedTools: ['Read', 'Grep', 'Glob'],
        },
      },
      {
        id: 'planner',
        name: 'Planner',
        description: 'Creates implementation plans',
        soulContent: '# Planner\nYou create detailed plans...',
        dirPath: '/path/to/agents/planner',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { agents: mockAgents },
      }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    });

    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Reviews code for quality and security')).toBeInTheDocument();
    expect(screen.getByText('Creates implementation plans')).toBeInTheDocument();
    expect(screen.getByText('2 agents configured')).toBeInTheDocument();
  });

  it('expands agent card when clicked', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test description',
        model: 'haiku',
        soulContent: '# Test Agent\nTest content',
        dirPath: '/path/to/agents/test',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { agents: mockAgents },
      }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });

    const agentCard = screen.getByText('Test Agent').closest('.agent-card-header');
    expect(agentCard).toBeInTheDocument();

    fireEvent.click(agentCard!);

    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    });

    expect(screen.getByText('Full Definition')).toBeInTheDocument();
    expect(screen.getByText(/id: test-agent/)).toBeInTheDocument();
    expect(screen.getByText(/model: haiku/)).toBeInTheDocument();
  });

  it('collapses agent card when clicked again', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        soulContent: '# Test',
        dirPath: '/path',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { agents: mockAgents },
      }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });

    const agentCard = screen.getByText('Test Agent').closest('.agent-card-header');

    // Expand
    fireEvent.click(agentCard!);

    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    });

    // Collapse
    fireEvent.click(agentCard!);

    await waitFor(() => {
      expect(screen.queryByText('Configuration')).not.toBeInTheDocument();
    });
  });

  it('displays model badge when model is specified', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        model: 'opus',
        soulContent: '# Test',
        dirPath: '/path',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { agents: mockAgents },
      }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('opus')).toBeInTheDocument();
    });
  });

  it('displays security badge when security policy exists', async () => {
    const mockAgents = [
      {
        id: 'secure-agent',
        name: 'Secure Agent',
        description: 'Has security policy',
        soulContent: '# Secure',
        dirPath: '/path',
        security: {
          allowedTools: ['Read'],
          disallowedTools: ['Write', 'Edit'],
        },
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { agents: mockAgents },
      }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Secure Agent')).toBeInTheDocument();
    });

    const securityBadge = screen.getByTitle('Has security policy');
    expect(securityBadge).toBeInTheDocument();
  });

  it('new agent button is disabled', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { agents: [] },
      }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('+ New Agent')).toBeInTheDocument();
    });

    const newButton = screen.getByText('+ New Agent') as HTMLButtonElement;
    expect(newButton.disabled).toBe(true);
  });
});
