import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { MCPPanel } from './MCPPanel';

global.fetch = jest.fn();

const mockServers = {
  servers: [
    {
      name: 'github',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'secret123' },
      },
      scope: 'user',
      enabled: true,
    },
    {
      name: 'api-server',
      config: {
        type: 'http',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer token123' },
      },
      scope: 'project',
      enabled: true,
    },
  ],
};

describe('MCPPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(<MCPPanel />);

    expect(screen.getByText('Loading servers...')).toBeInTheDocument();
  });

  it('renders server list successfully', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockServers,
    });

    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('github')).toBeInTheDocument();
    });

    expect(screen.getByText('api-server')).toBeInTheDocument();
    expect(screen.getByText('2 servers configured')).toBeInTheDocument();
  });

  it('shows empty state when no servers', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    expect(screen.getByText('Add servers to extend Claude\'s capabilities with external tools')).toBeInTheDocument();
    expect(screen.getByText('+ Add your first server')).toBeInTheDocument();
  });

  it('handles network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failed'));

    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Network error: Network failed/)).toBeInTheDocument();
    });
  });

  it('handles HTTP error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      text: async () => 'Server error',
    });

    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load servers: Server error/)).toBeInTheDocument();
    });
  });

  it('displays server types correctly', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockServers,
    });

    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('github')).toBeInTheDocument();
    });

    expect(screen.getAllByText('stdio')[0]).toBeInTheDocument();
    expect(screen.getAllByText('HTTP')[0]).toBeInTheDocument();
  });

  it('displays server scopes correctly', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockServers,
    });

    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('github')).toBeInTheDocument();
    });

    expect(screen.getAllByText('user')[0]).toBeInTheDocument();
    expect(screen.getAllByText('project')[0]).toBeInTheDocument();
  });

  it('expands server details on click', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockServers,
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('github')).toBeInTheDocument();
    });

    // Details should not be visible initially
    expect(screen.queryByText('npx -y @modelcontextprotocol/server-github')).not.toBeInTheDocument();

    const githubRow = screen.getByText('github').closest('.mcp-server-row');
    fireEvent.click(githubRow!);

    // Details should now be visible
    expect(screen.getByText('npx -y @modelcontextprotocol/server-github')).toBeInTheDocument();
    expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
  });

  it('toggles add form visibility', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    // Form should not be visible
    expect(screen.queryByPlaceholderText('my-server')).not.toBeInTheDocument();

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    // Form should now be visible
    expect(screen.getByPlaceholderText('my-server')).toBeInTheDocument();
    expect(screen.getByText('NEW SERVER')).toBeInTheDocument();
  });

  it('allows filling out stdio server form', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    const nameInput = screen.getByPlaceholderText('my-server');
    fireEvent.change(nameInput, { target: { value: 'test-server' } });

    const commandInput = screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-github');
    fireEvent.change(commandInput, { target: { value: 'node server.js' } });

    const argsInput = screen.getByPlaceholderText('--flag value (space-separated)');
    fireEvent.change(argsInput, { target: { value: '--port 3000' } });

    expect(nameInput).toHaveValue('test-server');
    expect(commandInput).toHaveValue('node server.js');
    expect(argsInput).toHaveValue('--port 3000');
  });

  it('allows switching to HTTP server type', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    const httpButton = screen.getAllByText('http').find(el => el.closest('.mcp-type-btn'));
    fireEvent.click(httpButton!);

    expect(screen.getByPlaceholderText('https://api.example.com/mcp')).toBeInTheDocument();
  });

  it('allows adding environment variables dynamically', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    const keyInputs = screen.getAllByPlaceholderText('KEY');
    const valueInputs = screen.getAllByPlaceholderText('value');

    expect(keyInputs.length).toBe(1);

    // Type in the first key/value pair
    fireEvent.change(keyInputs[0], { target: { value: 'API_KEY' } });
    fireEvent.change(valueInputs[0], { target: { value: 'secret' } });

    // A new empty row should be added automatically
    await waitFor(() => {
      const newKeyInputs = screen.getAllByPlaceholderText('KEY');
      expect(newKeyInputs.length).toBe(2);
    });
  });

  it('disables Add Server button when required fields are empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    const submitButton = screen.getByText('Add Server');
    expect(submitButton).toBeDisabled();

    const nameInput = screen.getByPlaceholderText('my-server');
    fireEvent.change(nameInput, { target: { value: 'test' } });

    // Still disabled (no command)
    expect(submitButton).toBeDisabled();

    const commandInput = screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-github');
    fireEvent.change(commandInput, { target: { value: 'node server.js' } });

    // Now enabled
    expect(submitButton).not.toBeDisabled();
  });

  it('submits new stdio server', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    const nameInput = screen.getByPlaceholderText('my-server');
    fireEvent.change(nameInput, { target: { value: 'new-server' } });

    const commandInput = screen.getByPlaceholderText('npx -y @modelcontextprotocol/server-github');
    fireEvent.change(commandInput, { target: { value: 'node server.js' } });

    const submitButton = screen.getByText('Add Server');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/mcp/servers'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"name":"new-server"'),
        })
      );
    });
  });

  it('cancels add form', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    expect(screen.getByPlaceholderText('my-server')).toBeInTheDocument();

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(screen.queryByPlaceholderText('my-server')).not.toBeInTheDocument();
  });

  it('removes a server', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers,
      })
      .mockResolvedValueOnce({
        ok: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ servers: [mockServers.servers[1]] }), // github removed
      });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('github')).toBeInTheDocument();
    });

    // Expand the server
    const githubRow = screen.getByText('github').closest('.mcp-server-row');
    fireEvent.click(githubRow!);

    const removeButton = screen.getByText('Remove');
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/mcp/servers/github'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  it('shows env variables when expanded', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockServers,
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('github')).toBeInTheDocument();
    });

    const githubRow = screen.getByText('github').closest('.mcp-server-row');
    fireEvent.click(githubRow!);

    expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('secret123')).toBeInTheDocument();
  });

  it('shows headers when HTTP server expanded', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockServers,
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('api-server')).toBeInTheDocument();
    });

    const apiRow = screen.getByText('api-server').closest('.mcp-server-row');
    fireEvent.click(apiRow!);

    expect(screen.getByText('Authorization')).toBeInTheDocument();
    expect(screen.getByText('Bearer token123')).toBeInTheDocument();
  });

  it('disables project scope when no projectPath', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    const projectButtons = screen.getAllByText('project').filter(el => el.closest('.mcp-type-btn'));
    const projectButton = projectButtons[0] as HTMLButtonElement;

    expect(projectButton).toBeDisabled();
    expect(projectButton.title).toBe('Open a project first');
  });

  it('enables project scope when projectPath is provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });

    
    render(<MCPPanel projectPath="/Users/test/project" />);

    await waitFor(() => {
      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
    });

    const addButton = screen.getByText('+');
    fireEvent.click(addButton);

    const projectButtons = screen.getAllByText('project').filter(el => el.closest('.mcp-type-btn'));
    const projectButton = projectButtons[0] as HTMLButtonElement;

    expect(projectButton).not.toBeDisabled();
  });

  it('retries on error', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('Network failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers,
      });

    
    render(<MCPPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Network error: Network failed/)).toBeInTheDocument();
    });

    const retryButton = screen.getByText('Retry');
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('github')).toBeInTheDocument();
    });
  });
});
