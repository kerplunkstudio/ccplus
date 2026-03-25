import React, { useState, useCallback, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useWorkspace } from './hooks/useWorkspace';
import { useTabSocket } from './hooks/useTabSocket';
import { useCaptainSocket } from './hooks/useCaptainSocket';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ChatPanel } from './components/ChatPanel';
import { ActivityTree } from './components/ActivityTree';
import { ProjectDashboard } from './components/ProjectDashboard';
import { InsightsPanel } from './components/InsightsPanel';
import { ProfilePanel, useProfile } from './components/ProfilePanel';
import { MCPPanel } from './components/MCPPanel';
import { AgentsPanel } from './components/AgentsPanel';
import { WorkflowsPanel } from './components/WorkflowsPanel';
import { SettingsPage } from './components/SettingsPage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BrowserTab } from './components/BrowserTab';
import { TerminalTab } from './components/TerminalTab';
import { CaptainDashboard } from './components/CaptainDashboard';
import UpdateBanner from './components/UpdateBanner';
import ProjectSidebar from './components/ProjectSidebar';
import TabBar from './components/TabBar';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { CommandPalette } from './components/CommandPalette';
import { ThemeProvider } from './theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/ToastContainer';
import { WindowWithElectron, ImageAttachment } from './types';
import './App.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_SIDEBAR_WIDTH = 260;

// Console easter egg
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  console.log(
    '%c CC+ %c Observability for Claude Code %c\n\n' +
    'You found the console. Respect.\n' +
    'github.com/kerplunkstudio/ccplus',
    'background: #22D3EE; color: #18181B; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px;',
    'background: #27272A; color: #E4E4E7; padding: 4px 8px; border-radius: 0 4px 4px 0;',
    ''
  );
}

function AppContent() {
  const workspace = useWorkspace();
  const { activeProject, activeTab } = workspace;
  const profile = useProfile();

  // Store the screenshot capture function from BrowserTab
  const screenshotCaptureFnRef = useRef<(() => Promise<{ image: string | null; url: string; error?: string }>) | null>(null);

  // Track the last chat tab sessionId so terminal tabs can show chat underneath
  const lastChatSessionIdRef = useRef<string>('');

  // Update last chat session when a non-terminal, non-browser tab is active
  useEffect(() => {
    if (activeTab && activeTab.type !== 'terminal' && activeTab.type !== 'browser') {
      lastChatSessionIdRef.current = activeTab.sessionId;
    }
  }, [activeTab]);

  // Use last chat session for socket when terminal is active
  const socketSessionId = (activeTab?.type === 'terminal' ? lastChatSessionIdRef.current : activeTab?.sessionId) || '';

  const handleDevServerDetected = useCallback((url: string) => {
    if (!activeProject) return;

    // Extract label from URL (e.g., "localhost:3000")
    const label = url.replace(/^https?:\/\//, '');
    const truncatedLabel = label.length > 30 ? label.substring(0, 30) + '...' : label;

    // Open browser tab
    workspace.addBrowserTab(activeProject.path, url, truncatedLabel);
  }, [activeProject, workspace]);

  const socketData = useTabSocket(socketSessionId, { onDevServerDetected: handleDevServerDetected });
  const {
    socket,
    connected,
    messages,
    streaming,
    backgroundProcessing,
    currentTool,
    activityTree,
    usageStats,
    toolLog,
    sendMessage,
    cancelQuery,
    pendingQuestion,
    respondToQuestion,
    duplicateSession,
    isRestoringSession,
    signals,
    promptSuggestions,
    rateLimitState,
    contextTokens,
    isModelThinking,
    todos,
    setTodos,
    scheduledTasks,
    createScheduledTask,
    deleteScheduledTask,
    pauseScheduledTask,
    resumeScheduledTask,
  } = socketData;

  // Lift Captain state to App level so it persists across page navigation
  const captainState = useCaptainSocket(socket);

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('ccplus_selected_model') || DEFAULT_MODEL;
  });

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem('ccplus_sidebar_width');
    return stored ? parseInt(stored, 10) : DEFAULT_SIDEBAR_WIDTH;
  });

  const [mobileDrawer, setMobileDrawer] = useState<'sessions' | 'activity' | null>(null);

  const [showDashboard, setShowDashboard] = useState<boolean>(false);


  const [activePage, setActivePage] = useState<string | null>(null);

  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);

  const [isFirstRun, setIsFirstRun] = useState<boolean>(false);
  const [checkingFirstRun, setCheckingFirstRun] = useState<boolean>(true);

  const [version, setVersion] = useState<string | null>(null);

  const [pendingInput, setPendingInput] = useState<string | null>(null);

  // Socket for screenshot capture (separate from useTabSocket to avoid circular deps)
  const screenshotSocketRef = useRef<Socket | null>(null);

  const handleSelectModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('ccplus_selected_model', model);
  };

  // One-time cleanup of old token for upgrading users
  useEffect(() => {
    localStorage.removeItem('ccplus_token');
  }, []);

  // Setup socket connection for screenshot capture
  useEffect(() => {
    if (!activeTab?.sessionId) return;

    // Create socket if not exists
    if (!screenshotSocketRef.current) {
      const newSocket = io(SOCKET_URL, {
        transports: ['polling', 'websocket'],
      });
      screenshotSocketRef.current = newSocket;
    }

    const socket = screenshotSocketRef.current;

    // Handler for screenshot capture requests
    const handleCaptureScreenshot = async (data: { session_id: string }) => {
      // Only respond if this is for our active session
      if (data.session_id !== activeTab.sessionId) return;

      // Only respond if we have a browser tab active
      if (activeTab.type !== 'browser' || !screenshotCaptureFnRef.current) {
        socket.emit('screenshot_result', {
          session_id: data.session_id,
          error: 'No browser tab is currently active',
        });
        return;
      }

      try {
        const result = await screenshotCaptureFnRef.current();
        socket.emit('screenshot_result', {
          session_id: data.session_id,
          image: result.image,
          url: result.url,
          error: result.error,
        });
      } catch (error) {
        socket.emit('screenshot_result', {
          session_id: data.session_id,
          error: `Screenshot capture failed: ${String(error)}`,
        });
      }
    };

    socket.on('capture_screenshot', handleCaptureScreenshot);

    return () => {
      socket.off('capture_screenshot', handleCaptureScreenshot);
    };
  }, [activeTab]);

  // Cleanup socket on unmount
  useEffect(() => {
    return () => {
      if (screenshotSocketRef.current) {
        screenshotSocketRef.current.close();
        screenshotSocketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const response = await fetch('/api/status/first-run');

        if (response.ok) {
          const data = await response.json();
          setIsFirstRun(data.first_run);
        }
      } catch (error) {
        console.error('Failed to check first-run status:', error);
      } finally {
        setCheckingFirstRun(false);
      }
    };

    checkFirstRun();
  }, []);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await fetch('/api/version');
        if (response.ok) {
          const data = await response.json();
          setVersion(data.version);
        }
      } catch (error) {
        console.error('Failed to fetch version:', error);
      }
    };

    fetchVersion();
  }, []);

  const handleAddProject = useCallback((path: string, name: string) => {
    workspace.addProject(path, name);
  }, [workspace]);

  const handleRemoveProject = useCallback((path: string) => {
    workspace.removeProject(path);
  }, [workspace]);

  const handleSelectProject = useCallback((path: string) => {
    workspace.selectProject(path);
    setMobileDrawer(null);
    setShowDashboard(true);
    setActivePage(null);
  }, [workspace]);

  const handleSelectTab = useCallback((projectPath: string, sessionId: string) => {
    workspace.selectProject(projectPath);
    workspace.selectTab(projectPath, sessionId);
    setShowDashboard(false);
    setActivePage(null);
  }, [workspace]);

  const handleSelectTabQuiet = useCallback((projectPath: string, sessionId: string) => {
    workspace.selectProject(projectPath);
    workspace.selectTabQuiet(projectPath, sessionId);
    setShowDashboard(false);
  }, [workspace]);

  const handleNewTab = useCallback(() => {
    if (!activeProject) return;
    workspace.addTab(activeProject.path);
    setShowDashboard(false);
    setActivePage(null);
  }, [workspace, activeProject]);

  const handleNewTerminalTab = useCallback(() => {
    if (!activeProject) return;
    workspace.addTerminalTab(activeProject.path);
    setShowDashboard(false);
    setActivePage(null);
  }, [workspace, activeProject]);

  const handleNewTabForProject = useCallback((projectPath: string) => {
    workspace.addTab(projectPath);
    setShowDashboard(false);
    setActivePage(null);
  }, [workspace]);

  const handleLoadSession = useCallback((sessionId: string) => {
    if (!activeProject) return;
    workspace.addTab(activeProject.path, sessionId);
    setShowDashboard(false);
  }, [activeProject, workspace]);

  const handleFleetSessionClick = useCallback((sessionId: string, workspacePath: string) => {
    if (!workspacePath) return;

    // Extract project name from path
    const projectName = workspacePath.split('/').pop() || workspacePath;

    // Ensure project exists
    const existingProject = workspace.state.projects.find(p => p.path === workspacePath);
    if (!existingProject) {
      workspace.addProject(workspacePath, projectName);
    }

    // Select the project and add tab
    workspace.selectProject(workspacePath);
    workspace.addTab(workspacePath, sessionId, sessionId);

    // Navigate away from Captain view
    setActivePage(null);
    setShowDashboard(false);
  }, [workspace]);

  const handleCloseTabInActiveProject = useCallback((sessionId: string) => {
    if (!activeProject) return;
    const remainingTabs = activeProject.tabs.filter(t => t.sessionId !== sessionId);
    workspace.closeTab(activeProject.path, sessionId);
    if (remainingTabs.length === 0) {
      setActivePage('captain');
    }
  }, [workspace, activeProject]);

  const handleCloseTab = useCallback((projectPath: string, sessionId: string) => {
    const project = workspace.state.projects.find(p => p.path === projectPath);
    const remainingTabs = project ? project.tabs.filter(t => t.sessionId !== sessionId) : [];
    workspace.closeTab(projectPath, sessionId);
    if (remainingTabs.length === 0) {
      setActivePage('captain');
    }
  }, [workspace]);

  const handleSelectTabInActiveProject = useCallback((sessionId: string) => {
    if (!activeProject) return;
    workspace.selectTab(activeProject.path, sessionId);
    setShowDashboard(false);
  }, [workspace, activeProject]);

  const handleSelectTabInActiveProjectQuiet = useCallback((sessionId: string) => {
    if (!activeProject) return;
    workspace.selectTabQuiet(activeProject.path, sessionId);
    setShowDashboard(false);
  }, [workspace, activeProject]);

  const handleSidebarWidthChange = useCallback((width: number) => {
    setSidebarWidth(width);
    localStorage.setItem('ccplus_sidebar_width', width.toString());
  }, []);

  const lastLabeledSessionRef = useRef<string | null>(null);
  const prevActiveSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProject || !activeTab || messages.length === 0) return;
    if (activeTab.label !== 'New session') return;
    if (lastLabeledSessionRef.current === activeTab.sessionId) return;
    // Skip during session restore — messages may belong to a different session
    if (isRestoringSession) return;
    // Skip if tab just switched — messages haven't synced yet
    if (activeTab.sessionId !== prevActiveSessionRef.current) return;

    const firstUserMessage = messages.find(m => m.role === 'user');
    if (!firstUserMessage || !firstUserMessage.content) return;

    // Only label if this message was sent in the current tab's session
    // (messages clear on tab switch, so if messages exist they belong to this session)
    if (firstUserMessage.id.startsWith('user_')) {
      const content = firstUserMessage.content;
      const truncated = content.length > 30
        ? content.substring(0, 30) + '...'
        : content;
      lastLabeledSessionRef.current = activeTab.sessionId;
      workspace.updateTabLabel(activeProject.path, activeTab.sessionId, truncated);
    }
  }, [messages, activeProject, activeTab, workspace, isRestoringSession]);

  useEffect(() => {
    prevActiveSessionRef.current = activeTab?.sessionId || null;
  }, [activeTab?.sessionId]);

  useEffect(() => {
    if (!activeProject || !activeTab) return;
    workspace.setTabStreaming(activeProject.path, activeTab.sessionId, streaming);
  }, [streaming, activeProject, activeTab, workspace]);

  // Keyboard shortcuts (Cmd+T new tab, Cmd+W close tab, Cmd+K command palette, Escape cancel, Ctrl+Tab MRU tab switching)
  useKeyboardShortcuts({
    activeProject,
    activeTab,
    projects: workspace.state.projects,
    showCommandPalette,
    activePage,
    streaming,
    handleNewTab,
    handleCloseTabInActiveProject,
    handleSelectTabInActiveProjectQuiet,
    handleSelectTabQuiet,
    setShowCommandPalette,
    setActivePage,
    cancelQuery,
    onSelectTab: handleSelectTab,
  });

  const handleSendMessage = useCallback((content: string, workspace?: string, model?: string, imageIds?: string[], images?: ImageAttachment[]) => {
    sendMessage(content, workspace || activeTab?.projectPath || activeProject?.path || undefined, model || selectedModel, imageIds, images);
  }, [sendMessage, activeTab, activeProject, selectedModel]);

  const toggleDrawer = useCallback((drawer: 'sessions' | 'activity') => {
    setMobileDrawer((prev) => (prev === drawer ? null : drawer));
  }, []);

  const handleNavigate = useCallback((page: string) => {
    setActivePage(prev => prev === page ? null : page);
    setShowDashboard(false);
  }, []);

  const handleWelcomePrompt = useCallback((prompt: string) => {
    if (!activeProject) {
      return;
    }
    handleNewTab();
    setTimeout(() => {
      sendMessage(prompt);
    }, 100);
  }, [activeProject, handleNewTab, sendMessage]);

  const handleWelcomeAddProject = useCallback((path: string, name: string) => {
    handleAddProject(path, name);
    setIsFirstRun(false);
  }, [handleAddProject]);

  const handleSendToNewSession = useCallback((text: string) => {
    if (!activeProject) return;

    // Create a new tab
    workspace.addTab(activeProject.path);

    // Set the text as pending input for the new session
    setPendingInput(text);
  }, [activeProject, workspace]);

  const handleOpenBrowserTab = useCallback((url: string, label: string) => {
    // Handle file:// URLs (file paths)
    if (url.startsWith('file://')) {
      const windowWithElectron = window as WindowWithElectron;
      if (windowWithElectron.electronAPI?.openExternal) {
        // Electron can open files directly with file:// protocol
        windowWithElectron.electronAPI.openExternal(url);
      } else {
        // In web mode, just copy to clipboard since we can't open local files
        const filePath = url.replace('file://', '');
        navigator.clipboard.writeText(filePath);
      }
      return;
    }

    // Open URL in system browser (Electron) or new tab (web mode)
    const windowWithElectron = window as WindowWithElectron;
    if (windowWithElectron.electronAPI?.openExternal) {
      windowWithElectron.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const handleDuplicateTab = useCallback((sessionId: string) => {
    if (!activeProject) return;
    const newSessionId = workspace.duplicateTab(activeProject.path, sessionId);
    // Tell backend to copy conversation/tool data
    duplicateSession(sessionId, newSessionId);
  }, [workspace, activeProject, duplicateSession]);

  const handleRenameTab = useCallback((sessionId: string, newLabel: string) => {
    if (!activeProject) return;
    workspace.updateTabLabel(activeProject.path, sessionId, newLabel);
  }, [workspace, activeProject]);

  const handleRenameTabInProject = useCallback((projectPath: string, sessionId: string, newLabel: string) => {
    workspace.updateTabLabel(projectPath, sessionId, newLabel);
  }, [workspace]);

  const handleClearPendingInput = useCallback(() => {
    setPendingInput(null);
  }, []);

  const handleClearTodos = useCallback(() => {
    setTodos([]);
  }, [setTodos]);

  const handleToggleActivityPanel = useCallback(() => {
    toggleDrawer('activity');
  }, [toggleDrawer]);


  // Build flat list of all tabs across all projects, with project name as label
  const allTabs = workspace.state.projects.flatMap(project =>
    project.tabs.map(tab => ({
      ...tab,
      label: project.name,  // Use project name as tab label
      projectPath: project.path,  // Ensure projectPath is set
    }))
  );

  const hasProjects = workspace.state.projects.length > 0;
  const shouldShowWelcome = isFirstRun && !hasProjects && !checkingFirstRun;
  const hasTabs = activeProject && activeProject.tabs.length > 0;
  const shouldShowDashboard = activeProject && (showDashboard || !hasTabs) && !activePage;
  const isBrowserTab = activeTab?.type === 'browser';
  const isTerminalTab = activeTab?.type === 'terminal';
  // Chat shows for all tabs except browser tabs (terminal floats on top of chat)
  const shouldShowChatPanel = activeProject && hasTabs && !showDashboard && !isBrowserTab;
  const shouldShowBrowserTab = activeProject && hasTabs && !showDashboard && !activePage && isBrowserTab;
  const shouldShowInsights = activePage === 'insights';
  const shouldShowProfile = activePage === 'profile';
  const shouldShowMcp = activePage === 'mcp';
  const shouldShowAgents = activePage === 'agents';
  const shouldShowWorkflows = activePage === 'workflows';
  const shouldShowCaptain = activePage === 'captain';
  const shouldShowSettings = activePage === 'settings';

  const contentMode = shouldShowWelcome ? 'welcome'
    : shouldShowInsights ? 'insights'
    : shouldShowProfile ? 'profile'
    : shouldShowMcp ? 'mcp'
    : shouldShowAgents ? 'agents'
    : shouldShowWorkflows ? 'workflows'
    : shouldShowCaptain ? 'captain'
    : shouldShowSettings ? 'settings'
    : shouldShowDashboard ? 'dashboard'
    : shouldShowBrowserTab ? 'browser'
    : shouldShowChatPanel ? 'chat'
    : 'no-project';

  const appReady = connected;

  return (
    <>
      <AppLoadingScreen ready={appReady} />
      <ToastContainer />
      <UpdateBanner />
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        projects={workspace.state.projects}
        activeProjectPath={workspace.state.activeProjectPath}
        onSelectTab={handleSelectTab}
        onSelectProject={handleSelectProject}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTabInActiveProject}
        onNavigate={handleNavigate}
        onToggleActivityPanel={handleToggleActivityPanel}
        onNewTerminalTab={handleNewTerminalTab}
        onOpenSession={(projectPath, sessionId, label) => {
          workspace.addTab(projectPath, sessionId, label);
          setActivePage(null);
        }}
      />
      <div
        className="app-layout"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
        data-chat-font={profile.chatFont}
      >
        {mobileDrawer && (
          <div
            className="mobile-overlay"
            onClick={() => setMobileDrawer(null)}
            role="button"
            aria-label="Close drawer"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setMobileDrawer(null)}
          />
        )}

      <div className={`panel-sidebar ${mobileDrawer === 'sessions' ? 'mobile-open' : ''}`}>
        <ProjectSidebar
          projects={workspace.state.projects}
          activeProjectPath={workspace.state.activeProjectPath}
          activeTabId={activeTab?.sessionId || null}
          onSelectProject={handleSelectProject}
          onSelectTab={handleSelectTab}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          onNewTabForProject={handleNewTabForProject}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTabInProject}
          onOpenSession={(projectPath, sessionId, label) => {
            workspace.addTab(projectPath, sessionId, label);
            setActivePage(null);
          }}
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={handleSidebarWidthChange}
          onNavigate={handleNavigate}
          activePage={activePage}
          version={version}
        />
      </div>

      <div className="panel-main">
        {workspace.state.projects.length > 0 && (
          <TabBar
            tabs={allTabs}
            activeTabId={activePage === 'captain' ? '' : (activeTab?.sessionId || '')}
            isCaptainActive={activePage === 'captain'}
            onCaptainClick={() => setActivePage('captain')}
            onSelectTab={(sessionId) => {
              // Find which project this tab belongs to
              const tab = allTabs.find(t => t.sessionId === sessionId);
              if (tab && tab.projectPath) {
                setActivePage(null);
                handleSelectTab(tab.projectPath, sessionId);
              }
            }}
            onNewTab={handleNewTab}
            onNewTerminalTab={handleNewTerminalTab}
            onCloseTab={(sessionId) => {
              const tab = allTabs.find(t => t.sessionId === sessionId);
              if (tab && tab.projectPath) {
                handleCloseTab(tab.projectPath, sessionId);
              }
            }}
            onReopenTab={workspace.reopenTab}
            onCloseOtherTabs={(sessionId) => {
              const tab = allTabs.find(t => t.sessionId === sessionId);
              if (tab && tab.projectPath) {
                workspace.closeOtherTabs(tab.projectPath, sessionId);
              }
            }}
            onDuplicateTab={handleDuplicateTab}
            onRenameTab={handleRenameTab}
            hasClosedTabs={workspace.hasClosedTabs}
          />
        )}
        <div className="panel-content">
          <div className={`panel-chat ${(shouldShowDashboard || shouldShowInsights || shouldShowProfile || shouldShowMcp || shouldShowAgents || shouldShowWorkflows || shouldShowCaptain || shouldShowSettings || shouldShowWelcome) ? 'full-width' : ''}`}>
            <div className={`panel-chat-content ${contentMode !== 'chat' && contentMode !== 'browser' ? 'panel-chat-content--centered' : ''}`}>
              {shouldShowWelcome ? (
                <WelcomeScreen
                  onSelectPrompt={handleWelcomePrompt}
                  onAddProject={handleWelcomeAddProject}
                />
              ) : shouldShowInsights ? (
                <InsightsPanel />
              ) : shouldShowProfile ? (
                <ProfilePanel />
              ) : shouldShowMcp ? (
                <MCPPanel projectPath={activeProject?.path} />
              ) : shouldShowAgents ? (
                <AgentsPanel />
              ) : shouldShowWorkflows ? (
                <WorkflowsPanel />
              ) : shouldShowCaptain ? (
                <CaptainDashboard socket={socket} captainState={captainState} onSessionClick={handleFleetSessionClick} />
              ) : shouldShowSettings ? (
                <SettingsPage onClose={() => setActivePage(null)} />
              ) : activeProject ? (
                shouldShowDashboard ? (
                  <ProjectDashboard
                    projectPath={activeProject.path}
                    projectName={activeProject.name}
                    onNewSession={handleNewTab}
                    onLoadSession={handleLoadSession}
                  />
                ) : shouldShowBrowserTab && activeTab?.url ? (
                  <BrowserTab
                    url={activeTab.url}
                    onRegisterCapture={(fn) => {
                      screenshotCaptureFnRef.current = fn;
                    }}
                  />
                ) : null
              ) : (
                <div className="no-project-state">
                  <p>Open a project from the sidebar to get started</p>
                </div>
              )}
              {/* ChatPanel - always mounted when conditions met, hidden via CSS when panel pages are active */}
              {shouldShowChatPanel && (
                <div style={{ display: activePage ? 'none' : 'flex', flexDirection: 'column' as const, height: '100%' }}>
                  <ChatPanel
                    socket={socket}
                    messages={messages}
                    connected={connected}
                    streaming={streaming}
                    backgroundProcessing={backgroundProcessing}
                    currentTool={currentTool}
                    toolLog={toolLog}
                    selectedModel={selectedModel}
                    usageStats={usageStats}
                    onSendMessage={handleSendMessage}
                    onSelectModel={handleSelectModel}
                    onCancel={cancelQuery}
                    onToggleSessions={() => toggleDrawer('sessions')}
                    onToggleActivity={() => toggleDrawer('activity')}
                    projectPath={activeProject?.path || null}
                    onLoadSession={handleLoadSession}
                    sessionId={activeTab?.sessionId}
                    pendingQuestion={pendingQuestion}
                    onRespondToQuestion={respondToQuestion}
                    isRestoringSession={isRestoringSession}
                    onSendToNewSession={handleSendToNewSession}
                    onOpenBrowserTab={handleOpenBrowserTab}
                    signals={signals}
                    promptSuggestions={promptSuggestions}
                    rateLimitState={rateLimitState}
                    activityTree={activityTree}
                    isModelThinking={isModelThinking}
                    pendingInput={pendingInput}
                    onClearPendingInput={handleClearPendingInput}
                    todos={todos}
                    onClearTodos={handleClearTodos}
                    scheduledTasks={scheduledTasks}
                    onCreateScheduledTask={createScheduledTask}
                    onDeleteScheduledTask={deleteScheduledTask}
                    onPauseScheduledTask={pauseScheduledTask}
                    onResumeScheduledTask={resumeScheduledTask}
                  />
                </div>
              )}
            </div>
          </div>
          {shouldShowChatPanel && !activePage && (
            <div key={activeTab?.sessionId} className={`panel-activity ${mobileDrawer === 'activity' ? 'mobile-open' : ''}`}>
              <ActivityTree tree={activityTree} usageStats={usageStats} contextTokens={contextTokens} sessionId={activeTab?.sessionId} workspacePath={activeProject?.path} streaming={streaming} />
            </div>
          )}
          {/* Floating terminal panels — always mounted, visibility toggled */}
          {activeProject && activeProject.tabs
            .filter(tab => tab.type === 'terminal')
            .map(tab => (
              <div
                key={tab.sessionId}
                style={{ display: isTerminalTab && activeTab?.sessionId === tab.sessionId ? 'block' : 'none' }}
              >
                <TerminalTab
                  terminalId={tab.sessionId}
                  cwd={tab.projectPath || activeProject.path}
                  socket={socket}
                  visible={isTerminalTab && activeTab?.sessionId === tab.sessionId}
                  onClose={() => handleCloseTabInActiveProject(tab.sessionId)}
                  onMinimize={() => {
                    if (lastChatSessionIdRef.current) {
                      handleSelectTabInActiveProject(lastChatSessionIdRef.current);
                    }
                  }}
                />
              </div>
            ))}
        </div>
      </div>
      </div>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
