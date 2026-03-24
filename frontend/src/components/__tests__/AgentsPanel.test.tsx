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
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

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
      json: async () => ({ agents: [] }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('No agents configured')).toBeInTheDocument();
    });

    expect(screen.getByText(/Create/)).toBeInTheDocument();
  });

  it('renders agent grid with names and models', async () => {
    const mockAgents = [
      {
        id: 'code-reviewer',
        name: 'Code Reviewer',
        description: 'Reviews code for quality',
        model: 'sonnet',
        soulContent: '',
        dirPath: '/path/to/agents/code-reviewer',
      },
      {
        id: 'planner',
        name: 'Planner',
        description: 'Creates implementation plans',
        model: 'opus',
        soulContent: '',
        dirPath: '/path/to/agents/planner',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: mockAgents }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    });

    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('2 agents')).toBeInTheDocument();
  });

  it('opens edit panel when tile is clicked', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test description',
        model: 'haiku',
        soulContent: '',
        dirPath: '/path/to/agents/test',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: mockAgents }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Agent'));

    await waitFor(() => {
      const editPanel = document.querySelector('.agent-edit-panel');
      expect(editPanel).toBeInTheDocument();
    });

    // Should show model selector pills
    expect(screen.getByText('sonnet')).toBeInTheDocument();
    expect(screen.getByText('opus')).toBeInTheDocument();
  });

  it('closes edit panel when tile is clicked again', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        soulContent: '',
        dirPath: '/path',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: mockAgents }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });

    const tile = screen.getByText('Test Agent');

    fireEvent.click(tile);
    await waitFor(() => {
      expect(document.querySelector('.agent-edit-panel')).toBeInTheDocument();
    });

    fireEvent.click(tile);
    await waitFor(() => {
      expect(document.querySelector('.agent-edit-panel')).not.toBeInTheDocument();
    });
  });

  it('displays model badge on tile', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        model: 'opus',
        soulContent: '',
        dirPath: '/path',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: mockAgents }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('opus')).toBeInTheDocument();
    });

    const modelBadge = screen.getByText('opus');
    expect(modelBadge.classList.contains('agent-tile-model-opus')).toBe(true);
  });

  it('shows blocked tools in edit panel', async () => {
    const mockAgents = [
      {
        id: 'secure-agent',
        name: 'Secure Agent',
        description: 'Has security policy',
        soulContent: '',
        dirPath: '/path',
        security: {
          disallowedTools: ['Write', 'Edit'],
        },
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: mockAgents }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Secure Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Secure Agent'));

    await waitFor(() => {
      const writeButton = screen.getAllByText('Write').find((el) => el.classList.contains('agent-tool-toggle'));
      const editButton = screen.getAllByText('Edit').find((el) => el.classList.contains('agent-tool-toggle'));

      expect(writeButton).toBeInTheDocument();
      expect(editButton).toBeInTheDocument();
      expect(writeButton?.classList.contains('agent-tool-toggle-active')).toBe(true);
      expect(editButton?.classList.contains('agent-tool-toggle-active')).toBe(true);
    });
  });

  it('shows icon picker in edit panel', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        soulContent: '',
        dirPath: '/path',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: mockAgents }),
    });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Agent'));

    await waitFor(() => {
      const iconPicker = document.querySelector('.agent-icon-picker');
      expect(iconPicker).toBeInTheDocument();
    });

    // Should have 20 icon options
    const iconOptions = document.querySelectorAll('.agent-icon-option');
    expect(iconOptions.length).toBe(20);
  });

  it('allows toggling blocked tools', async () => {
    const mockAgents = [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        soulContent: '',
        dirPath: '/path',
        security: {
          disallowedTools: [],
        },
      },
    ];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agents: mockAgents }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    render(<AgentsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Test Agent'));

    await waitFor(() => {
      const bashButton = screen.getAllByText('Bash').find((el) => el.classList.contains('agent-tool-toggle'));
      expect(bashButton).toBeInTheDocument();
      expect(bashButton?.classList.contains('agent-tool-toggle-active')).toBe(false);

      if (bashButton) {
        fireEvent.click(bashButton);
      }
    });

    await waitFor(() => {
      const bashButton = screen.getAllByText('Bash').find((el) => el.classList.contains('agent-tool-toggle'));
      expect(bashButton?.classList.contains('agent-tool-toggle-active')).toBe(true);
    });
  });
});
