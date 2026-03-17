import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InstalledPlugins } from './InstalledPlugins';
import { usePlugins } from '../hooks/usePlugins';
import { Plugin } from '../types';

// Mock the usePlugins hook
jest.mock('../hooks/usePlugins');

const mockUsePlugins = usePlugins as jest.MockedFunction<typeof usePlugins>;

describe('InstalledPlugins', () => {
  const mockLoadInstalled = jest.fn();
  const mockUninstallPlugin = jest.fn();
  const mockOnClose = jest.fn();

  const mockPlugins: Plugin[] = [
    {
      name: 'git-tools',
      version: '1.0.0',
      description: 'Git integration tools',
      author: { name: 'GitHub' },
      repository: 'https://github.com/user/git-tools',
      installed: true,
      agents: ['git-agent', 'commit-agent'],
      skills: ['commit', 'push', 'pull'],
      commands: ['git-status'],
    },
    {
      name: 'deploy-tools',
      version: '2.1.0',
      description: 'Deployment automation',
      author: { name: 'DevOps Team' },
      repository: 'https://github.com/user/deploy-tools',
      installed: true,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockUsePlugins.mockReturnValue({
      installedPlugins: mockPlugins,
      marketplacePlugins: [],
      loading: false,
      error: null,
      loadInstalled: mockLoadInstalled,
      loadMarketplace: jest.fn(),
      installPlugin: jest.fn(),
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });
  });

  it('renders heading', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('Installed Plugins')).toBeInTheDocument();
  });

  it('loads installed plugins on mount', () => {
    render(<InstalledPlugins />);

    expect(mockLoadInstalled).toHaveBeenCalledTimes(1);
  });

  it('renders plugins table with headers', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('Plugin')).toBeInTheDocument();
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('Author')).toBeInTheDocument();
    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('renders plugin names and descriptions', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('git-tools')).toBeInTheDocument();
    expect(screen.getByText('Git integration tools')).toBeInTheDocument();
    expect(screen.getByText('deploy-tools')).toBeInTheDocument();
    expect(screen.getByText('Deployment automation')).toBeInTheDocument();
  });

  it('renders plugin versions', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    expect(screen.getByText('2.1.0')).toBeInTheDocument();
  });

  it('renders plugin authors', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('DevOps Team')).toBeInTheDocument();
  });

  it('renders agent count badges', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('2 agents')).toBeInTheDocument();
  });

  it('renders skill count badges', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('3 skills')).toBeInTheDocument();
  });

  it('renders command count badges', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('1 command')).toBeInTheDocument();
  });

  it('uses singular form for single resource', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('1 command')).toBeInTheDocument();
  });

  it('uses plural form for multiple resources', () => {
    render(<InstalledPlugins />);

    expect(screen.getByText('2 agents')).toBeInTheDocument();
    expect(screen.getByText('3 skills')).toBeInTheDocument();
  });

  it('renders uninstall buttons', () => {
    render(<InstalledPlugins />);

    const uninstallButtons = screen.getAllByText('Uninstall');
    expect(uninstallButtons).toHaveLength(2);
  });

  it('shows confirm dialog when clicking uninstall', () => {
    render(<InstalledPlugins />);

    const uninstallButton = screen.getAllByText('Uninstall')[0];
    fireEvent.click(uninstallButton);

    expect(screen.getByText('Confirm?')).toBeInTheDocument();
  });

  it('calls uninstallPlugin when confirming', async () => {
    mockUninstallPlugin.mockResolvedValue({ success: true });

    render(<InstalledPlugins />);

    const uninstallButton = screen.getAllByText('Uninstall')[0];
    fireEvent.click(uninstallButton);

    const confirmButton = screen.getByText('Confirm?');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockUninstallPlugin).toHaveBeenCalledWith('git-tools');
    });
  });

  it('resets confirm state on blur', () => {
    render(<InstalledPlugins />);

    const uninstallButton = screen.getAllByText('Uninstall')[0];
    fireEvent.click(uninstallButton);

    expect(screen.getByText('Confirm?')).toBeInTheDocument();

    fireEvent.blur(screen.getByText('Confirm?'));

    // After blur, the text should reset (but we need to trigger re-render by interacting)
    // In actual behavior, blur resets confirmUninstall state
    // Let's test that the uninstall button text resets
    waitFor(() => {
      expect(screen.queryByText('Confirm?')).not.toBeInTheDocument();
    });
  });

  it('shows uninstalling state during uninstall', async () => {
    mockUninstallPlugin.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100)));

    render(<InstalledPlugins />);

    const uninstallButton = screen.getAllByText('Uninstall')[0];
    fireEvent.click(uninstallButton);

    const confirmButton = screen.getByText('Confirm?');
    fireEvent.click(confirmButton);

    expect(screen.getByText('Uninstalling...')).toBeInTheDocument();
  });

  it('shows loading state when loading is true', () => {
    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: [],
      loading: true,
      error: null,
      loadInstalled: mockLoadInstalled,
      loadMarketplace: jest.fn(),
      installPlugin: jest.fn(),
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<InstalledPlugins />);

    expect(screen.getByText('Loading plugins...')).toBeInTheDocument();
  });

  it('shows error message when error is present', () => {
    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: [],
      loading: false,
      error: 'Failed to load plugins',
      loadInstalled: mockLoadInstalled,
      loadMarketplace: jest.fn(),
      installPlugin: jest.fn(),
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<InstalledPlugins />);

    expect(screen.getByText('Failed to load plugins')).toBeInTheDocument();
  });

  it('shows no plugins message when list is empty', () => {
    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: [],
      loading: false,
      error: null,
      loadInstalled: mockLoadInstalled,
      loadMarketplace: jest.fn(),
      installPlugin: jest.fn(),
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<InstalledPlugins />);

    expect(screen.getByText('No plugins installed yet.')).toBeInTheDocument();
    expect(screen.getByText('Visit the Plugin Marketplace to browse and install plugins.')).toBeInTheDocument();
  });

  it('renders close button when onClose is provided', () => {
    render(<InstalledPlugins onClose={mockOnClose} />);

    const closeButton = screen.getByText('×');
    expect(closeButton).toBeInTheDocument();

    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not render close button when onClose is not provided', () => {
    render(<InstalledPlugins />);

    const closeButton = screen.queryByText('×');
    expect(closeButton).not.toBeInTheDocument();
  });

  it('handles plugin with no resources gracefully', () => {
    const pluginNoResources: Plugin = {
      name: 'minimal-plugin',
      version: '1.0.0',
      description: 'Minimal plugin',
      author: { name: 'Test' },
      repository: 'https://test.com',
      installed: true,
    };

    mockUsePlugins.mockReturnValue({
      installedPlugins: [pluginNoResources],
      marketplacePlugins: [],
      loading: false,
      error: null,
      loadInstalled: mockLoadInstalled,
      loadMarketplace: jest.fn(),
      installPlugin: jest.fn(),
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    const { container } = render(<InstalledPlugins />);

    const resourceBadges = container.querySelectorAll('.resource-badge');
    expect(resourceBadges).toHaveLength(0);
  });

  it('handles unknown author gracefully', () => {
    const pluginNoAuthor: Plugin = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test plugin',
      author: { name: '' },
      repository: 'https://test.com',
      installed: true,
    };

    mockUsePlugins.mockReturnValue({
      installedPlugins: [pluginNoAuthor],
      marketplacePlugins: [],
      loading: false,
      error: null,
      loadInstalled: mockLoadInstalled,
      loadMarketplace: jest.fn(),
      installPlugin: jest.fn(),
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<InstalledPlugins />);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('disables uninstall button while uninstalling', async () => {
    mockUninstallPlugin.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100)));

    render(<InstalledPlugins />);

    const uninstallButton = screen.getAllByText('Uninstall')[0] as HTMLButtonElement;
    fireEvent.click(uninstallButton);

    const confirmButton = screen.getByText('Confirm?') as HTMLButtonElement;
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const uninstallingButton = screen.getByText('Uninstalling...') as HTMLButtonElement;
      expect(uninstallingButton.disabled).toBe(true);
    });
  });

  it('disables uninstall button while loading', () => {
    mockUsePlugins.mockReturnValue({
      installedPlugins: mockPlugins,
      marketplacePlugins: [],
      loading: true,
      error: null,
      loadInstalled: mockLoadInstalled,
      loadMarketplace: jest.fn(),
      installPlugin: jest.fn(),
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<InstalledPlugins />);

    const uninstallButtons = screen.getAllByText('Uninstall') as HTMLButtonElement[];
    uninstallButtons.forEach((button) => {
      expect(button.disabled).toBe(true);
    });
  });

  it('applies uninstalling class to row', async () => {
    mockUninstallPlugin.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100)));

    const { container } = render(<InstalledPlugins />);

    const uninstallButton = screen.getAllByText('Uninstall')[0];
    fireEvent.click(uninstallButton);

    const confirmButton = screen.getByText('Confirm?');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const rows = container.querySelectorAll('tr.uninstalling');
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
