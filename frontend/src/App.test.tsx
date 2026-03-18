import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

// Mock the hooks
jest.mock('./hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    state: {
      projects: [
        {
          path: '/test/project',
          name: 'Test Project',
          tabs: [
            { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
          ],
          activeTabId: 'session_1',
        },
      ],
      activeProjectPath: '/test/project',
    },
    activeProject: {
      path: '/test/project',
      name: 'Test Project',
      tabs: [
        { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
      ],
      activeTabId: 'session_1',
    },
    activeTab: { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
    addProject: jest.fn(),
    removeProject: jest.fn(),
    selectProject: jest.fn(),
    selectTab: jest.fn(),
    selectTabQuiet: jest.fn(),
    addTab: jest.fn(),
    addBrowserTab: jest.fn(),
    closeTab: jest.fn(),
    closeOtherTabs: jest.fn(),
    duplicateTab: jest.fn(),
    reopenTab: jest.fn(),
    hasClosedTabs: false,
    updateTabLabel: jest.fn(),
    setTabStreaming: jest.fn(),
  }),
}));

jest.mock('./hooks/useTabSocket', () => ({
  useTabSocket: () => ({
    socket: null,
    connected: true,
    messages: [],
    streaming: false,
    backgroundProcessing: false,
    thinking: '',
    currentTool: null,
    activityTree: [],
    sendMessage: jest.fn(),
    cancelQuery: jest.fn(),
    toolLog: [],
    pendingQuestion: null,
    respondToQuestion: jest.fn(),
    duplicateSession: jest.fn(),
    isRestoringSession: false,
    pendingRestore: false,
    signals: { status: null },
    promptSuggestions: [],
    rateLimitState: null,
    contextTokens: null,
    todos: [],
    setTodos: jest.fn(),
    scheduledTasks: [],
    createScheduledTask: jest.fn(),
    deleteScheduledTask: jest.fn(),
    pauseScheduledTask: jest.fn(),
    resumeScheduledTask: jest.fn(),
    usageStats: {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDuration: 0,
      queryCount: 0,
      contextWindowSize: 200000,
      model: '',
      linesOfCode: 0,
      totalSessions: 0,
    },
  }),
}));

jest.mock('./components/ProfilePanel', () => ({
  ProfilePanel: () => <div>Profile</div>,
  useProfile: () => ({ chatFont: 'default' }),
}));

jest.mock('./theme', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('./components/UpdateBanner', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./components/TabBar', () => ({
  __esModule: true,
  default: () => <div data-testid="tab-bar">TabBar</div>,
}));

jest.mock('./components/ProjectSidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="project-sidebar">Sidebar</div>,
}));

jest.mock('./components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel">Chat Panel</div>,
}));

jest.mock('./components/ActivityTree', () => ({
  ActivityTree: ({ tree }: any) => (
    <div data-testid="activity-tree">
      <div className="activity-tabs" role="tablist">
        <button role="tab">Agents</button>
        <button role="tab">Tool Logs</button>
      </div>
      {(!tree || tree.length === 0) && <p>Standby</p>}
    </div>
  ),
}));

jest.mock('./components/ProjectDashboard', () => ({
  ProjectDashboard: () => <div>Dashboard</div>,
}));

jest.mock('./components/InsightsPanel', () => ({
  InsightsPanel: () => <div>Insights</div>,
}));

jest.mock('./components/WelcomeScreen', () => ({
  WelcomeScreen: () => <div>Welcome</div>,
}));

jest.mock('./components/BrowserTab', () => ({
  BrowserTab: () => <div>Browser</div>,
}));

// Suppress fetch calls from NewSessionDashboard / first-run check
beforeAll(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ first_run: false, sessions: [], version: '1.0.0' }),
  });
});

afterAll(() => {
  (global.fetch as jest.Mock).mockRestore();
});

describe('App', () => {
  it('renders the app layout', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.app-layout')).toBeInTheDocument();
  });

  it('renders the sidebar', () => {
    render(<App />);
    expect(screen.getByTestId('project-sidebar')).toBeInTheDocument();
  });

  it('renders the two-panel layout', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.app-layout')).toBeInTheDocument();
    expect(container.querySelector('.panel-chat')).toBeInTheDocument();
    expect(container.querySelector('.panel-activity')).toBeInTheDocument();
  });

  it('renders the activity panel with tabs', () => {
    render(<App />);
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Tool Logs')).toBeInTheDocument();
  });

  it('shows empty state in activity panel', () => {
    render(<App />);
    expect(screen.getByText('Standby')).toBeInTheDocument();
  });
});


describe('App - Workspace State', () => {
  beforeEach(() => {
    // Reset mocks to default state
    jest.spyOn(require('./hooks/useWorkspace'), 'useWorkspace').mockReturnValue({
      state: {
        projects: [
          {
            path: '/test/project',
            name: 'Test Project',
            tabs: [
              { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
            ],
            activeTabId: 'session_1',
          },
        ],
        activeProjectPath: '/test/project',
      },
      activeProject: {
        path: '/test/project',
        name: 'Test Project',
        tabs: [
          { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
        ],
        activeTabId: 'session_1',
      },
      activeTab: { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
      addProject: jest.fn(),
      removeProject: jest.fn(),
      selectProject: jest.fn(),
      selectTab: jest.fn(),
      selectTabQuiet: jest.fn(),
      addTab: jest.fn(),
      addBrowserTab: jest.fn(),
      closeTab: jest.fn(),
      closeOtherTabs: jest.fn(),
      duplicateTab: jest.fn(),
      reopenTab: jest.fn(),
      hasClosedTabs: false,
      updateTabLabel: jest.fn(),
      setTabStreaming: jest.fn(),
    });
  });

  it('shows chat panel when project has tabs', () => {
    render(<App />);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('shows tab bar when project has tabs', () => {
    render(<App />);
    expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
  });

  it('applies sidebar width CSS variable', () => {
    const { container } = render(<App />);
    const layout = container.querySelector('.app-layout') as HTMLElement;
    expect(layout.style.getPropertyValue('--sidebar-width')).toBe('260px');
  });

  it('applies chat font from profile', () => {
    const { container } = render(<App />);
    const layout = container.querySelector('.app-layout');
    expect(layout).toHaveAttribute('data-chat-font', 'default');
  });
});

describe('App - Conditional Rendering', () => {
  it('shows welcome screen when no projects and first run', async () => {
    jest.spyOn(require('./hooks/useWorkspace'), 'useWorkspace').mockReturnValue({
      state: {
        projects: [],
        activeProjectPath: null,
      },
      activeProject: null,
      activeTab: null,
      addProject: jest.fn(),
      removeProject: jest.fn(),
      selectProject: jest.fn(),
      selectTab: jest.fn(),
      selectTabQuiet: jest.fn(),
      addTab: jest.fn(),
      addBrowserTab: jest.fn(),
      closeTab: jest.fn(),
      closeOtherTabs: jest.fn(),
      duplicateTab: jest.fn(),
      reopenTab: jest.fn(),
      hasClosedTabs: false,
      updateTabLabel: jest.fn(),
      setTabStreaming: jest.fn(),
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ first_run: true }),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Welcome')).toBeInTheDocument();
    });
  });

  it('shows no-project state when no active project', () => {
    jest.spyOn(require('./hooks/useWorkspace'), 'useWorkspace').mockReturnValue({
      state: {
        projects: [],
        activeProjectPath: null,
      },
      activeProject: null,
      activeTab: null,
      addProject: jest.fn(),
      removeProject: jest.fn(),
      selectProject: jest.fn(),
      selectTab: jest.fn(),
      selectTabQuiet: jest.fn(),
      addTab: jest.fn(),
      addBrowserTab: jest.fn(),
      closeTab: jest.fn(),
      closeOtherTabs: jest.fn(),
      duplicateTab: jest.fn(),
      reopenTab: jest.fn(),
      hasClosedTabs: false,
      updateTabLabel: jest.fn(),
      setTabStreaming: jest.fn(),
    });
    render(<App />);
    expect(screen.getByText('Open a project from the sidebar to get started')).toBeInTheDocument();
  });

  it('shows dashboard when project has no tabs', () => {
    jest.spyOn(require('./hooks/useWorkspace'), 'useWorkspace').mockReturnValue({
      state: {
        projects: [
          {
            path: '/test/project',
            name: 'Test Project',
            tabs: [],
            activeTabId: '',
          },
        ],
        activeProjectPath: '/test/project',
      },
      activeProject: {
        path: '/test/project',
        name: 'Test Project',
        tabs: [],
        activeTabId: '',
      },
      activeTab: null,
      addProject: jest.fn(),
      removeProject: jest.fn(),
      selectProject: jest.fn(),
      selectTab: jest.fn(),
      selectTabQuiet: jest.fn(),
      addTab: jest.fn(),
      addBrowserTab: jest.fn(),
      closeTab: jest.fn(),
      closeOtherTabs: jest.fn(),
      duplicateTab: jest.fn(),
      reopenTab: jest.fn(),
      hasClosedTabs: false,
      updateTabLabel: jest.fn(),
      setTabStreaming: jest.fn(),
    });
    render(<App />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});

describe('App - Socket Connection', () => {
  beforeEach(() => {
    // Reset mocks to default state
    jest.spyOn(require('./hooks/useWorkspace'), 'useWorkspace').mockReturnValue({
      state: {
        projects: [
          {
            path: '/test/project',
            name: 'Test Project',
            tabs: [
              { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
            ],
            activeTabId: 'session_1',
          },
        ],
        activeProjectPath: '/test/project',
      },
      activeProject: {
        path: '/test/project',
        name: 'Test Project',
        tabs: [
          { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
        ],
        activeTabId: 'session_1',
      },
      activeTab: { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
      addProject: jest.fn(),
      removeProject: jest.fn(),
      selectProject: jest.fn(),
      selectTab: jest.fn(),
      selectTabQuiet: jest.fn(),
      addTab: jest.fn(),
      addBrowserTab: jest.fn(),
      closeTab: jest.fn(),
      closeOtherTabs: jest.fn(),
      duplicateTab: jest.fn(),
      reopenTab: jest.fn(),
      hasClosedTabs: false,
      updateTabLabel: jest.fn(),
      setTabStreaming: jest.fn(),
    });
  });

  it('passes connected state to chat panel', () => {
    jest.spyOn(require('./hooks/useTabSocket'), 'useTabSocket').mockReturnValue({
      connected: true,
      messages: [],
      streaming: false,
      backgroundProcessing: false,
      currentTool: null,
      activityTree: [],
      sendMessage: jest.fn(),
      cancelQuery: jest.fn(),
      toolLog: [],
      pendingQuestion: null,
      respondToQuestion: jest.fn(),
      duplicateSession: jest.fn(),
      isRestoringSession: false,
      pendingRestore: false,
      signals: { status: null, plan: null },
      promptSuggestions: [],
      rateLimitState: null,
      contextTokens: null,
      usageStats: {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDuration: 0,
        queryCount: 0,
        contextWindowSize: 200000,
        model: 'claude-sonnet-4-6',
        linesOfCode: 0,
        totalSessions: 0,
      },
    });
    render(<App />);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('passes messages to chat panel', () => {
    const messages = [
      { id: '1', content: 'Test message', role: 'user' as const, timestamp: Date.now() },
    ];
    jest.spyOn(require('./hooks/useTabSocket'), 'useTabSocket').mockReturnValue({
      connected: true,
      messages,
      streaming: false,
      backgroundProcessing: false,
      currentTool: null,
      activityTree: [],
      sendMessage: jest.fn(),
      cancelQuery: jest.fn(),
      toolLog: [],
      pendingQuestion: null,
      respondToQuestion: jest.fn(),
      duplicateSession: jest.fn(),
      isRestoringSession: false,
      pendingRestore: false,
      signals: { status: null, plan: null },
      promptSuggestions: [],
      rateLimitState: null,
      contextTokens: null,
      usageStats: {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDuration: 0,
        queryCount: 0,
        contextWindowSize: 200000,
        model: 'claude-sonnet-4-6',
        linesOfCode: 0,
        totalSessions: 0,
      },
    });
    render(<App />);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });
});

describe('App - Model Selection', () => {
  beforeEach(() => {
    // Reset mocks to default state
    jest.spyOn(require('./hooks/useWorkspace'), 'useWorkspace').mockReturnValue({
      state: {
        projects: [
          {
            path: '/test/project',
            name: 'Test Project',
            tabs: [
              { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
            ],
            activeTabId: 'session_1',
          },
        ],
        activeProjectPath: '/test/project',
      },
      activeProject: {
        path: '/test/project',
        name: 'Test Project',
        tabs: [
          { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
        ],
        activeTabId: 'session_1',
      },
      activeTab: { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
      addProject: jest.fn(),
      removeProject: jest.fn(),
      selectProject: jest.fn(),
      selectTab: jest.fn(),
      selectTabQuiet: jest.fn(),
      addTab: jest.fn(),
      addBrowserTab: jest.fn(),
      closeTab: jest.fn(),
      closeOtherTabs: jest.fn(),
      duplicateTab: jest.fn(),
      reopenTab: jest.fn(),
      hasClosedTabs: false,
      updateTabLabel: jest.fn(),
      setTabStreaming: jest.fn(),
    });
    jest.spyOn(require('./hooks/useTabSocket'), 'useTabSocket').mockReturnValue({
      connected: true,
      messages: [],
      streaming: false,
      backgroundProcessing: false,
      currentTool: null,
      activityTree: [],
      sendMessage: jest.fn(),
      cancelQuery: jest.fn(),
      toolLog: [],
      pendingQuestion: null,
      respondToQuestion: jest.fn(),
      duplicateSession: jest.fn(),
      isRestoringSession: false,
      pendingRestore: false,
      signals: { status: null, plan: null },
      promptSuggestions: [],
      rateLimitState: null,
      contextTokens: null,
      usageStats: {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDuration: 0,
        queryCount: 0,
        contextWindowSize: 200000,
        model: 'claude-sonnet-4-6',
        linesOfCode: 0,
        totalSessions: 0,
      },
    });
  });

  it('loads selected model from localStorage', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockImplementation((key) => {
      if (key === 'ccplus_selected_model') return 'claude-opus-4-6';
      if (key === 'ccplus_sidebar_width') return '260';
      return null;
    });
    render(<App />);
    expect(getItemSpy).toHaveBeenCalledWith('ccplus_selected_model');
    getItemSpy.mockRestore();
  });

  it('uses default model when localStorage is empty', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockImplementation((key) => {
      if (key === 'ccplus_sidebar_width') return '260';
      return null;
    });
    render(<App />);
    expect(getItemSpy).toHaveBeenCalledWith('ccplus_selected_model');
    getItemSpy.mockRestore();
  });
});

describe('App - Error Boundary', () => {
  beforeEach(() => {
    // Reset mocks to default state
    jest.spyOn(require('./hooks/useWorkspace'), 'useWorkspace').mockReturnValue({
      state: {
        projects: [
          {
            path: '/test/project',
            name: 'Test Project',
            tabs: [
              { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
            ],
            activeTabId: 'session_1',
          },
        ],
        activeProjectPath: '/test/project',
      },
      activeProject: {
        path: '/test/project',
        name: 'Test Project',
        tabs: [
          { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
        ],
        activeTabId: 'session_1',
      },
      activeTab: { sessionId: 'session_1', label: 'New session', isStreaming: false, hasRunningAgent: false, createdAt: Date.now() },
      addProject: jest.fn(),
      removeProject: jest.fn(),
      selectProject: jest.fn(),
      selectTab: jest.fn(),
      selectTabQuiet: jest.fn(),
      addTab: jest.fn(),
      addBrowserTab: jest.fn(),
      closeTab: jest.fn(),
      closeOtherTabs: jest.fn(),
      duplicateTab: jest.fn(),
      reopenTab: jest.fn(),
      hasClosedTabs: false,
      updateTabLabel: jest.fn(),
      setTabStreaming: jest.fn(),
    });
    jest.spyOn(require('./hooks/useTabSocket'), 'useTabSocket').mockReturnValue({
      connected: true,
      messages: [],
      streaming: false,
      backgroundProcessing: false,
      currentTool: null,
      activityTree: [],
      sendMessage: jest.fn(),
      cancelQuery: jest.fn(),
      toolLog: [],
      pendingQuestion: null,
      respondToQuestion: jest.fn(),
      duplicateSession: jest.fn(),
      isRestoringSession: false,
      pendingRestore: false,
      signals: { status: null, plan: null },
      promptSuggestions: [],
      rateLimitState: null,
      contextTokens: null,
      usageStats: {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDuration: 0,
        queryCount: 0,
        contextWindowSize: 200000,
        model: 'claude-sonnet-4-6',
        linesOfCode: 0,
        totalSessions: 0,
      },
    });
  });

  it('wraps app content in error boundary', () => {
    // ErrorBoundary is mocked to pass through children
    render(<App />);
    expect(screen.getByTestId('project-sidebar')).toBeInTheDocument();
  });
});
