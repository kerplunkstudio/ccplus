import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginMarketplace } from './PluginMarketplace';
import { usePlugins } from '../hooks/usePlugins';
import { Plugin } from '../types';

// Mock the usePlugins hook
jest.mock('../hooks/usePlugins');

const mockUsePlugins = usePlugins as jest.MockedFunction<typeof usePlugins>;

describe('PluginMarketplace', () => {
  const mockLoadMarketplace = jest.fn();
  const mockInstallPlugin = jest.fn();
  const mockUninstallPlugin = jest.fn();
  const mockOnClose = jest.fn();

  const mockPlugins: Plugin[] = [
    {
      name: 'git-tools',
      version: '1.0.0',
      description: 'Git integration tools',
      author: { name: 'GitHub', url: 'https://github.com' },
      repository: 'https://github.com/user/git-tools',
      installed: false,
      keywords: ['git', 'vcs', 'version-control'],
      agents: ['git-agent'],
      skills: ['commit', 'push'],
      commands: ['git-status'],
    },
    {
      name: 'deploy-tools',
      version: '2.1.0',
      description: 'Deployment automation',
      author: { name: 'DevOps Team' },
      repository: 'https://github.com/user/deploy-tools',
      installed: true,
      homepage: 'https://example.com',
      license: 'MIT',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: mockPlugins,
      loading: false,
      error: null,
      loadInstalled: jest.fn(),
      loadMarketplace: mockLoadMarketplace,
      installPlugin: mockInstallPlugin,
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });
  });

  it('renders heading', () => {
    render(<PluginMarketplace />);

    expect(screen.getByText('Plugin Marketplace')).toBeInTheDocument();
  });

  it('loads marketplace plugins on mount', () => {
    render(<PluginMarketplace />);

    expect(mockLoadMarketplace).toHaveBeenCalledTimes(1);
  });

  it('renders search input', () => {
    render(<PluginMarketplace />);

    const searchInput = screen.getByPlaceholderText('Search plugins...');
    expect(searchInput).toBeInTheDocument();
  });

  it('renders plugin cards', () => {
    render(<PluginMarketplace />);

    expect(screen.getByText('git-tools')).toBeInTheDocument();
    expect(screen.getByText('deploy-tools')).toBeInTheDocument();
    expect(screen.getByText('Git integration tools')).toBeInTheDocument();
    expect(screen.getByText('Deployment automation')).toBeInTheDocument();
  });

  it('renders plugin versions', () => {
    render(<PluginMarketplace />);

    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('v2.1.0')).toBeInTheDocument();
  });

  it('renders plugin authors', () => {
    render(<PluginMarketplace />);

    expect(screen.getByText(/by GitHub/)).toBeInTheDocument();
    expect(screen.getByText(/by DevOps Team/)).toBeInTheDocument();
  });

  it('renders plugin keywords', () => {
    render(<PluginMarketplace />);

    expect(screen.getByText('git')).toBeInTheDocument();
    expect(screen.getByText('vcs')).toBeInTheDocument();
    expect(screen.getByText('version-control')).toBeInTheDocument();
  });

  it('shows install button for non-installed plugins', () => {
    render(<PluginMarketplace />);

    const installButtons = screen.getAllByText('Install');
    expect(installButtons.length).toBeGreaterThan(0);
  });

  it('shows uninstall button for installed plugins', () => {
    render(<PluginMarketplace />);

    expect(screen.getByText('Uninstall')).toBeInTheDocument();
  });

  it('calls installPlugin when clicking install button', async () => {
    mockInstallPlugin.mockResolvedValue({ success: true });

    render(<PluginMarketplace />);

    const installButton = screen.getAllByText('Install')[0];
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(mockInstallPlugin).toHaveBeenCalledWith('https://github.com/user/git-tools');
    });
  });

  it('shows confirm dialog before uninstalling', async () => {
    render(<PluginMarketplace />);

    const uninstallButton = screen.getByText('Uninstall');
    fireEvent.click(uninstallButton);

    expect(screen.getByText('Confirm?')).toBeInTheDocument();
  });

  it('calls uninstallPlugin when confirming uninstall', async () => {
    mockUninstallPlugin.mockResolvedValue({ success: true });

    render(<PluginMarketplace />);

    const uninstallButton = screen.getByText('Uninstall');
    fireEvent.click(uninstallButton);

    const confirmButton = screen.getByText('Confirm?');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockUninstallPlugin).toHaveBeenCalledWith('deploy-tools');
    });
  });

  it('shows processing state during installation', async () => {
    mockInstallPlugin.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100)));

    render(<PluginMarketplace />);

    const installButton = screen.getAllByText('Install')[0];
    fireEvent.click(installButton);

    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('shows loading state when loading is true', () => {
    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: [],
      loading: true,
      error: null,
      loadInstalled: jest.fn(),
      loadMarketplace: mockLoadMarketplace,
      installPlugin: mockInstallPlugin,
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<PluginMarketplace />);

    expect(screen.getByText('Loading plugins...')).toBeInTheDocument();
  });

  it('shows error message when error is present', () => {
    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: [],
      loading: false,
      error: 'Failed to load plugins',
      loadInstalled: jest.fn(),
      loadMarketplace: mockLoadMarketplace,
      installPlugin: mockInstallPlugin,
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<PluginMarketplace />);

    expect(screen.getByText('Failed to load plugins')).toBeInTheDocument();
  });

  it('shows no plugins message when list is empty', () => {
    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: [],
      loading: false,
      error: null,
      loadInstalled: jest.fn(),
      loadMarketplace: mockLoadMarketplace,
      installPlugin: mockInstallPlugin,
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    render(<PluginMarketplace />);

    expect(screen.getByText('No plugins found')).toBeInTheDocument();
  });

  it('calls loadMarketplace when searching', () => {
    render(<PluginMarketplace />);

    const searchInput = screen.getByPlaceholderText('Search plugins...');
    fireEvent.change(searchInput, { target: { value: 'git' } });

    expect(mockLoadMarketplace).toHaveBeenCalledWith('git');
  });

  it('selects plugin when clicking on card', () => {
    render(<PluginMarketplace />);

    const gitToolsCard = screen.getByText('git-tools').closest('.plugin-card');
    fireEvent.click(gitToolsCard!);

    // Plugin details should be shown
    expect(screen.getAllByText('git-tools')).toHaveLength(2); // One in card, one in details
  });

  it('shows plugin details panel with metadata', () => {
    render(<PluginMarketplace />);

    const gitToolsCard = screen.getByText('git-tools').closest('.plugin-card');
    fireEvent.click(gitToolsCard!);

    expect(screen.getByText(/Author:/)).toBeInTheDocument();
    expect(screen.getByText(/Repository:/)).toBeInTheDocument();
  });

  it('shows agents in plugin details', () => {
    render(<PluginMarketplace />);

    const gitToolsCard = screen.getByText('git-tools').closest('.plugin-card');
    fireEvent.click(gitToolsCard!);

    expect(screen.getByText(/Agents:/)).toBeInTheDocument();
    expect(screen.getByText('git-agent')).toBeInTheDocument();
  });

  it('shows skills in plugin details', () => {
    render(<PluginMarketplace />);

    const gitToolsCard = screen.getByText('git-tools').closest('.plugin-card');
    fireEvent.click(gitToolsCard!);

    expect(screen.getByText(/Skills:/)).toBeInTheDocument();
    expect(screen.getByText('commit')).toBeInTheDocument();
    expect(screen.getByText('push')).toBeInTheDocument();
  });

  it('shows commands in plugin details', () => {
    render(<PluginMarketplace />);

    const gitToolsCard = screen.getByText('git-tools').closest('.plugin-card');
    fireEvent.click(gitToolsCard!);

    expect(screen.getByText(/Commands:/)).toBeInTheDocument();
    expect(screen.getByText('git-status')).toBeInTheDocument();
  });

  it('renders close button when onClose is provided', () => {
    render(<PluginMarketplace onClose={mockOnClose} />);

    const closeButton = screen.getByText('×');
    expect(closeButton).toBeInTheDocument();

    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not render close button when onClose is not provided', () => {
    render(<PluginMarketplace />);

    const closeButton = screen.queryByText('×');
    expect(closeButton).not.toBeInTheDocument();
  });

  it('shows empty details panel when no plugin is selected', () => {
    render(<PluginMarketplace />);

    expect(screen.getByText('Select a plugin to view details')).toBeInTheDocument();
  });

  it('stops event propagation when clicking install button in card', () => {
    mockInstallPlugin.mockResolvedValue({ success: true });

    render(<PluginMarketplace />);

    const installButton = screen.getAllByText('Install')[0];
    const stopPropagationSpy = jest.spyOn(Event.prototype, 'stopPropagation');

    fireEvent.click(installButton);

    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('renders homepage link when available', () => {
    render(<PluginMarketplace />);

    const deployToolsCard = screen.getByText('deploy-tools').closest('.plugin-card');
    fireEvent.click(deployToolsCard!);

    expect(screen.getByText(/Homepage:/)).toBeInTheDocument();
    const homepageLink = screen.getByText('https://example.com');
    expect(homepageLink).toHaveAttribute('href', 'https://example.com');
    expect(homepageLink).toHaveAttribute('target', '_blank');
  });

  it('renders license when available', () => {
    render(<PluginMarketplace />);

    const deployToolsCard = screen.getByText('deploy-tools').closest('.plugin-card');
    fireEvent.click(deployToolsCard!);

    expect(screen.getByText(/License:/)).toBeInTheDocument();
    expect(screen.getByText('MIT')).toBeInTheDocument();
  });

  it('handles author without URL', () => {
    render(<PluginMarketplace />);

    const deployToolsCard = screen.getByText('deploy-tools').closest('.plugin-card');
    fireEvent.click(deployToolsCard!);

    expect(screen.getByText(/by DevOps Team/)).toBeInTheDocument();
  });

  it('limits keywords display to 3 in card view', () => {
    const pluginWithManyKeywords: Plugin = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test',
      author: { name: 'Test' },
      repository: 'https://test.com',
      installed: false,
      keywords: ['k1', 'k2', 'k3', 'k4', 'k5'],
    };

    mockUsePlugins.mockReturnValue({
      installedPlugins: [],
      marketplacePlugins: [pluginWithManyKeywords],
      loading: false,
      error: null,
      loadInstalled: jest.fn(),
      loadMarketplace: mockLoadMarketplace,
      installPlugin: mockInstallPlugin,
      uninstallPlugin: mockUninstallPlugin,
      getPluginDetails: jest.fn(),
    });

    const { container } = render(<PluginMarketplace />);

    const card = container.querySelector('.plugin-card');
    const keywords = card?.querySelectorAll('.keyword');
    expect(keywords?.length).toBe(3);
  });
});
