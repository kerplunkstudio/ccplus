import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

// Mock the hooks
jest.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: '1', username: 'test' },
    token: 'test-token',
    loading: false,
    logout: jest.fn(),
  }),
}));

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
