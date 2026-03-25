import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { useSettings } from '../hooks/useSettings';

// Mock the useSettings hook
jest.mock('../hooks/useSettings');

const mockUseSettings = useSettings as jest.MockedFunction<typeof useSettings>;

const createDefaultMockConfig = () => ({
  models: {
    defaultModel: 'claude-sonnet-4.5-20250929',
    captainModel: 'claude-opus-4-20250514',
    agentModels: {},
    agent_overrides: {},
  },
  sessions: {
    maxConversationHistory: 50,
    autoSaveInterval: 30,
    keepAliveTimeout: 300,
  },
  memory: {
    enabled: true,
    maxEntries: 1000,
    retentionDays: 90,
  },
  workflow: {
    autoCommit: false,
    autoReview: true,
    testBeforeCommit: true,
  },
  captain: {
    enabled: false,
    autoAcceptTasks: false,
    maxConcurrentTasks: 3,
  },
  integrations: {
    github: {
      enabled: false,
      token: '',
    },
    slack: {
      enabled: false,
      webhookUrl: '',
    },
    telegram: {
      enabled: false,
      botToken: '',
      allowedUsers: [],
    },
    discord: {
      enabled: false,
      webhookUrl: '',
      allowedUsers: [],
    },
  },
});

describe('SettingsPage', () => {
  beforeEach(() => {
    mockUseSettings.mockReturnValue({
      config: createDefaultMockConfig(),
      loading: false,
      error: null,
      needsRestart: false,
      updateConfig: jest.fn(),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('displays the subtitle', () => {
    render(<SettingsPage />);
    expect(
      screen.getByText('Configure models, sessions, memory, and workflow preferences')
    ).toBeInTheDocument();
  });

  it('renders all category navigation pills', () => {
    render(<SettingsPage />);
    expect(screen.getAllByText('Models').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Memory').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Workflow').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Captain').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Integrations').length).toBeGreaterThan(0);
  });

  it('renders all sections when not loading', () => {
    const { container } = render(<SettingsPage />);
    const sections = container.querySelectorAll('.settings-section');
    expect(sections).toHaveLength(6);
  });

  it('shows loading state when loading', () => {
    mockUseSettings.mockReturnValue({
      config: createDefaultMockConfig(),
      loading: true,
      error: null,
      needsRestart: false,
      updateConfig: jest.fn(),
    });

    const { container } = render(<SettingsPage />);
    const skeletons = container.querySelectorAll('.settings-loading-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('displays error toast when error present', () => {
    mockUseSettings.mockReturnValue({
      config: createDefaultMockConfig(),
      loading: false,
      error: 'Failed to load settings',
      needsRestart: false,
      updateConfig: jest.fn(),
    });

    render(<SettingsPage />);
    expect(screen.getByText('Failed to load settings')).toBeInTheDocument();
  });

  it('displays restart toast when restart needed', () => {
    mockUseSettings.mockReturnValue({
      config: createDefaultMockConfig(),
      loading: false,
      error: null,
      needsRestart: true,
      updateConfig: jest.fn(),
    });

    render(<SettingsPage />);
    expect(screen.getByText('Restart required for changes to take effect')).toBeInTheDocument();
  });

  it('scrolls to section when pill is clicked', () => {
    render(<SettingsPage />);

    const modelsButton = screen.getAllByText('Models')[0]; // Navigation pill

    // Mock scrollIntoView
    const mockScrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = mockScrollIntoView;

    fireEvent.click(modelsButton);

    // scrollIntoView should have been called
    expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('has proper ARIA labels on navigation pills', () => {
    render(<SettingsPage />);

    const modelsButton = screen.getAllByText('Models')[0];
    expect(modelsButton).toHaveAttribute('aria-label', 'Scroll to Models settings');
  });

  it('renders with proper semantic structure', () => {
    const { container } = render(<SettingsPage />);

    // Should have main header
    const header = container.querySelector('.settings-header');
    expect(header).toBeInTheDocument();

    // Should have navigation
    const nav = container.querySelector('.settings-nav');
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveAttribute('role', 'navigation');

    // Should have sections container
    const sections = container.querySelector('.settings-sections');
    expect(sections).toBeInTheDocument();
  });
});
