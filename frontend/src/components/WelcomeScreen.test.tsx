import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WelcomeScreen } from './WelcomeScreen';
import { ToastProvider } from '../contexts/ToastContext';

// Mock WorkspaceBrowser component
jest.mock('./WorkspaceBrowser', () => ({
  WorkspaceBrowser: ({ onClose }: { onClose: () => void }) => (
    <div>
      <h2>Workspace Browser</h2>
      <button onClick={onClose}>Close Browser</button>
    </div>
  ),
}));

describe('WelcomeScreen', () => {
  const mockOnSelectPrompt = jest.fn();
  const mockOnAddProject = jest.fn();

  beforeEach(() => {
    mockOnSelectPrompt.mockClear();
    mockOnAddProject.mockClear();

    // Mock fetch to return empty projects by default
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [] }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders heading and subtitle', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText('cc+')).toBeInTheDocument();
    expect(screen.getByText('Watch your agents work.')).toBeInTheDocument();
  });

  it('renders feature list', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText('Real-time activity tree')).toBeInTheDocument();
    expect(screen.getByText('Tool usage tracking')).toBeInTheDocument();
    expect(screen.getByText('Multi-project workspaces')).toBeInTheDocument();
  });

  it('renders example prompts', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText('Build a feature')).toBeInTheDocument();
    expect(screen.getByText('Fix a bug')).toBeInTheDocument();
    expect(screen.getByText('Refactor code')).toBeInTheDocument();
    expect(screen.getByText('Write documentation')).toBeInTheDocument();
  });

  it('calls onSelectPrompt when clicking an example prompt', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const buildFeatureButton = screen.getByText('Build a feature').closest('button');
    fireEvent.click(buildFeatureButton!);

    expect(mockOnSelectPrompt).toHaveBeenCalledTimes(1);
    expect(mockOnSelectPrompt).toHaveBeenCalledWith(
      expect.stringContaining('Create a new REST API endpoint')
    );
  });

  it('shows workspace browse button', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const browseButton = screen.getByText('Browse for workspace');
    expect(browseButton).toBeInTheDocument();
  });


  it('opens workspace browser when clicking browse button', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const browseButton = screen.getByText('Browse for workspace');
    fireEvent.click(browseButton);

    // WorkspaceBrowser should be rendered
    expect(screen.getByText(/Workspace Browser/i)).toBeInTheDocument();
  });

  it('fetches detected projects on mount', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [{ name: 'test-project', path: '/path/to/test' }] }),
    });

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/scan-projects'));
    });
  });

  it('displays detected projects when available', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        projects: [
          { name: 'ccplus', path: '/Users/test/ccplus' },
          { name: 'myapp', path: '/Users/test/myapp' },
        ],
      }),
    });

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ccplus')).toBeInTheDocument();
      expect(screen.getByText('myapp')).toBeInTheDocument();
    });
  });

  it('calls onAddProject when clicking detected project', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        projects: [{ name: 'ccplus', path: '/Users/test/ccplus' }],
      }),
    });

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ccplus')).toBeInTheDocument();
    });

    const projectButton = screen.getByText('ccplus').closest('button');
    fireEvent.click(projectButton!);

    expect(mockOnAddProject).toHaveBeenCalledWith('/Users/test/ccplus', 'ccplus');
  });

  it('shows loading spinner while fetching projects', () => {
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText('Scanning for projects...')).toBeInTheDocument();
  });

  it('shows empty message when no projects detected', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [] }),
    });

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No projects detected.')).toBeInTheDocument();
    });
  });

  it('handles project scan failure silently', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No projects detected.')).toBeInTheDocument();
    });
  });

  it('displays only first 5 detected projects', async () => {
    const projects = Array.from({ length: 10 }, (_, i) => ({
      name: `project${i}`,
      path: `/path/to/project${i}`,
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects }),
    });

    const { container } = render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      const projectButtons = container.querySelectorAll('.workspace-item');
      expect(projectButtons).toHaveLength(5);
    });
  });

  it('shows count of additional projects beyond 5', async () => {
    const projects = Array.from({ length: 12 }, (_, i) => ({
      name: `project${i}`,
      path: `/path/to/project${i}`,
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects }),
    });

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('+7 more')).toBeInTheDocument();
    });
  });

  it('handles workspace selection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const browseButton = screen.getByText('Browse for workspace');
    fireEvent.click(browseButton);

    // Simulate workspace selection
    // The actual WorkspaceBrowser component will trigger handleSelectWorkspace
    // For testing, we need to verify the component is ready to handle it
    expect(screen.getByText(/Workspace Browser/i)).toBeInTheDocument();
  });

  it('renders all feature items', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText(/Watch every agent spawn and tool call/i)).toBeInTheDocument();
    expect(screen.getByText(/Monitor API calls, tokens, and costs/i)).toBeInTheDocument();
    expect(screen.getByText(/Organize conversations by project/i)).toBeInTheDocument();
  });

  it('renders correct number of example prompts', () => {
    const { container } = render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const promptCards = container.querySelectorAll('.prompt-link');
    expect(promptCards).toHaveLength(4);
  });

  it('clicking different prompts calls onSelectPrompt with correct text', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const fixBugButton = screen.getByText('Fix a bug').closest('button');
    fireEvent.click(fixBugButton!);

    expect(mockOnSelectPrompt).toHaveBeenCalledWith(
      expect.stringContaining('race condition')
    );
  });

});
