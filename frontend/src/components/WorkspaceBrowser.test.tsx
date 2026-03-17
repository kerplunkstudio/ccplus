import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkspaceBrowser } from './WorkspaceBrowser';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const SOCKET_URL = 'http://localhost:4000';

describe('WorkspaceBrowser', () => {
  const mockOnSelectWorkspace = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const defaultBrowseResponse = {
    path: '/Users/test',
    parent: '/Users',
    entries: [
      { name: 'project1', path: '/Users/test/project1', is_dir: true, is_git: true },
      { name: 'project2', path: '/Users/test/project2', is_dir: true, is_git: false },
    ],
  };

  const defaultProjectsResponse = {
    projects: [
      { name: 'ccplus', path: '/Users/test/ccplus' },
      { name: 'myapp', path: '/Users/test/myapp' },
    ],
  };

  it('renders correctly with initial props', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultProjectsResponse,
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    expect(screen.getByText('Browse Workspace')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('project1')).toBeInTheDocument();
    });

    expect(screen.getByText('project2')).toBeInTheDocument();
  });

  it('displays detected projects', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultProjectsResponse,
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Detected Projects')).toBeInTheDocument();
    });

    expect(screen.getByText('ccplus')).toBeInTheDocument();
    expect(screen.getByText('myapp')).toBeInTheDocument();
  });

  it('handles directory navigation by clicking folders', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultProjectsResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: '/Users/test/project1',
          parent: '/Users/test',
          entries: [
            { name: 'src', path: '/Users/test/project1/src', is_dir: true, is_git: false },
          ],
        }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('project1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('project1'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `${SOCKET_URL}/api/browse?path=${encodeURIComponent('/Users/test/project1')}`
      );
    });

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });
  });

  it('handles navigation via keyboard (Enter key)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultProjectsResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: '/Users/test/project1',
          parent: '/Users/test',
          entries: [],
        }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('project1')).toBeInTheDocument();
    });

    const dirItem = screen.getByText('project1').closest('[role="button"]');
    fireEvent.keyDown(dirItem!, { key: 'Enter' });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `${SOCKET_URL}/api/browse?path=${encodeURIComponent('/Users/test/project1')}`
      );
    });
  });

  it('handles navigation up to parent directory', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultProjectsResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: '/Users',
          parent: '/',
          entries: [],
        }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Go up')).toBeInTheDocument();
    });

    const upButton = screen.getByLabelText('Go up');
    expect(upButton).not.toBeDisabled();

    fireEvent.click(upButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `${SOCKET_URL}/api/browse?path=${encodeURIComponent('/Users')}`
      );
    });
  });

  it('disables "Go up" button when at root', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: '/',
          parent: null,
          entries: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Go up')).toBeDisabled();
    });
  });

  it('handles selecting current directory as workspace', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultProjectsResponse,
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Select as workspace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Select as workspace'));

    expect(mockOnSelectWorkspace).toHaveBeenCalledWith('/Users/test');
  });

  it('handles selecting detected project', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultProjectsResponse,
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('ccplus')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('ccplus'));

    expect(mockOnSelectWorkspace).toHaveBeenCalledWith('/Users/test/ccplus');
  });

  it('displays error state when fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Directory not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Directory not found')).toBeInTheDocument();
    });
  });

  it('displays generic error when fetch throws', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays loading state', async () => {
    let resolvePromise: (value: any) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    mockFetch.mockReturnValueOnce(promise);

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    resolvePromise!({
      ok: true,
      json: async () => defaultBrowseResponse,
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
  });

  it('displays "No directories found" when entries are empty', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: '/empty',
          parent: '/',
          entries: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('No directories found')).toBeInTheDocument();
    });
  });

  it('displays git badge for git directories', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('git')).toBeInTheDocument();
    });
  });

  it('closes when clicking overlay', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Browse Workspace')).toBeInTheDocument();
    });

    const overlay = screen.getByText('Browse Workspace').closest('.workspace-browser-overlay');
    fireEvent.click(overlay!);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('closes when clicking close button', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Close')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Close'));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside dialog', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Browse Workspace')).toBeInTheDocument();
    });

    const dialog = screen.getByText('Browse Workspace').closest('.workspace-browser');
    fireEvent.click(dialog!);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('silently fails when detected projects fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => defaultBrowseResponse,
      })
      .mockRejectedValueOnce(new Error('Projects fetch failed'));

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('project1')).toBeInTheDocument();
    });

    // Should not display detected projects section
    expect(screen.queryByText('Detected Projects')).not.toBeInTheDocument();
  });

  it('displays breadcrumbs correctly', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: '/Users/test/ccplus',
          parent: '/Users/test',
          entries: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('/Users')).toBeInTheDocument();
    });

    expect(screen.getByText('/test')).toBeInTheDocument();
    expect(screen.getByText('/ccplus')).toBeInTheDocument();
  });

  it('displays root breadcrumb when path is empty', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: '/',
          parent: null,
          entries: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [] }),
      });

    render(<WorkspaceBrowser onSelectWorkspace={mockOnSelectWorkspace} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('/')).toBeInTheDocument();
    });
  });
});
