/**
 * Regression test for handleOpenBrowserTab fix.
 *
 * Bug: In web mode (no electronAPI), clicking a link called window.open, which opens
 * a new browser tab outside of cc+ instead of adding a BrowserTab inside the app.
 *
 * Fix: handleOpenBrowserTab now calls workspace.addBrowserTab in web mode
 * so links open as BrowserTab widgets inside cc+.
 *
 * This test fails against the pre-fix code (window.open called) and passes after the fix.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import App from './App';

// Capture the onOpenBrowserTab prop passed by App to ChatPanel.
let capturedOnOpenBrowserTab: ((url: string, label: string) => void) | undefined;

jest.mock('./components/ChatPanel', () => ({
  ChatPanel: (props: any) => {
    capturedOnOpenBrowserTab = props.onOpenBrowserTab;
    return <div data-testid="chat-panel">Chat Panel</div>;
  },
}));

const addBrowserTabMock = jest.fn();

const makeWorkspaceMock = () => ({
  state: {
    projects: [
      {
        path: '/test/project',
        name: 'Test Project',
        tabs: [
          {
            sessionId: 'session_1',
            label: 'New session',
            isStreaming: false,
            hasRunningAgent: false,
            createdAt: Date.now(),
          },
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
      {
        sessionId: 'session_1',
        label: 'New session',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
      },
    ],
    activeTabId: 'session_1',
  },
  activeTab: {
    sessionId: 'session_1',
    label: 'New session',
    isStreaming: false,
    hasRunningAgent: false,
    createdAt: Date.now(),
  },
  addProject: jest.fn(),
  removeProject: jest.fn(),
  selectProject: jest.fn(),
  selectTab: jest.fn(),
  selectTabQuiet: jest.fn(),
  addTab: jest.fn(),
  addBrowserTab: addBrowserTabMock,
  closeTab: jest.fn(),
  closeOtherTabs: jest.fn(),
  duplicateTab: jest.fn(),
  reopenTab: jest.fn(),
  hasClosedTabs: false,
  updateTabLabel: jest.fn(),
  setTabStreaming: jest.fn(),
});

jest.mock('./hooks/useWorkspace', () => ({
  useWorkspace: () => makeWorkspaceMock(),
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

jest.mock('./components/ActivityTree', () => ({
  ActivityTree: () => <div data-testid="activity-tree" />,
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

jest.mock('./components/TerminalTab', () => ({
  __esModule: true,
  default: () => <div>Terminal</div>,
}));

jest.mock('./components/CaptainDashboard', () => ({
  CaptainDashboard: () => <div>Captain Dashboard</div>,
}));

jest.mock('./hooks/useFleetState', () => ({
  useFleetState: () => ({
    fleetState: { agents: [], sessions: [], workspaces: [] },
  }),
}));

jest.mock('./hooks/useCaptainSocket', () => ({
  useCaptainSocket: () => ({
    messages: [],
    isStreaming: false,
    isThinking: false,
    isModelThinking: false,
    sendMessage: jest.fn(),
    archivedConversations: [],
    clearHistory: jest.fn(),
  }),
}));

beforeAll(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ first_run: false, sessions: [], version: '1.0.0' }),
  });
});

afterAll(() => {
  (global.fetch as jest.Mock).mockRestore();
});

describe('handleOpenBrowserTab regression - web mode opens BrowserTab inside cc+', () => {
  let windowOpenSpy: jest.SpyInstance;

  beforeEach(() => {
    capturedOnOpenBrowserTab = undefined;
    addBrowserTabMock.mockClear();
    // Ensure no electronAPI is present (simulates web mode)
    delete (window as any).electronAPI;
    windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    windowOpenSpy.mockRestore();
  });

  it('calls addBrowserTab (not window.open) when opening a web URL in web mode', () => {
    render(<App />);

    // The App must have passed onOpenBrowserTab to ChatPanel
    expect(capturedOnOpenBrowserTab).toBeDefined();

    act(() => {
      capturedOnOpenBrowserTab!('https://example.com', 'Example Site');
    });

    // Fix: addBrowserTab should be called with the project path, URL, and truncated label
    expect(addBrowserTabMock).toHaveBeenCalledWith(
      '/test/project',
      'https://example.com',
      'Example Site'
    );

    // Pre-fix behavior: window.open must NOT be called
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it('truncates labels longer than 30 characters when opening a BrowserTab', () => {
    render(<App />);

    expect(capturedOnOpenBrowserTab).toBeDefined();

    const longLabel = 'This is a very long page title that exceeds thirty chars';

    act(() => {
      capturedOnOpenBrowserTab!('https://example.com/page', longLabel);
    });

    expect(addBrowserTabMock).toHaveBeenCalledWith(
      '/test/project',
      'https://example.com/page',
      'This is a very long page title\u2026'
    );
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it('uses electronAPI.openExternal for web URLs when running inside Electron', () => {
    const openExternalMock = jest.fn();
    (window as any).electronAPI = { openExternal: openExternalMock };

    render(<App />);

    expect(capturedOnOpenBrowserTab).toBeDefined();

    act(() => {
      capturedOnOpenBrowserTab!('https://example.com', 'Example');
    });

    expect(openExternalMock).toHaveBeenCalledWith('https://example.com');
    // Neither addBrowserTab nor window.open should be called in Electron mode
    expect(addBrowserTabMock).not.toHaveBeenCalled();
    expect(windowOpenSpy).not.toHaveBeenCalled();

    delete (window as any).electronAPI;
  });

  it('uses electronAPI.openExternal for file:// URLs in Electron mode', () => {
    const openExternalMock = jest.fn();
    (window as any).electronAPI = { openExternal: openExternalMock };

    render(<App />);

    expect(capturedOnOpenBrowserTab).toBeDefined();

    act(() => {
      capturedOnOpenBrowserTab!('file:///home/user/file.txt', 'Local File');
    });

    expect(openExternalMock).toHaveBeenCalledWith('file:///home/user/file.txt');
    expect(addBrowserTabMock).not.toHaveBeenCalled();
    expect(windowOpenSpy).not.toHaveBeenCalled();

    delete (window as any).electronAPI;
  });

  it('copies file path to clipboard for file:// URLs in web mode (no Electron)', () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<App />);

    expect(capturedOnOpenBrowserTab).toBeDefined();

    act(() => {
      capturedOnOpenBrowserTab!('file:///home/user/file.txt', 'Local File');
    });

    expect(writeTextMock).toHaveBeenCalledWith('/home/user/file.txt');
    expect(addBrowserTabMock).not.toHaveBeenCalled();
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });
});
