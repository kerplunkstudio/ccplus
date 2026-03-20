import React, { useState, useCallback, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useWorkspace } from './hooks/useWorkspace';
import { useTabSocket } from './hooks/useTabSocket';
import { ChatPanel } from './components/ChatPanel';
import { ActivityTree } from './components/ActivityTree';
import { ProjectDashboard } from './components/ProjectDashboard';
import { InsightsPanel } from './components/InsightsPanel';
import { ProfilePanel, useProfile } from './components/ProfilePanel';
import { MCPPanel } from './components/MCPPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { BrowserTab } from './components/BrowserTab';
import { TerminalTab } from './components/TerminalTab';
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
import { ensureMruOrder } from './utils/tabs';
import './App.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

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
    todos,
    setTodos,
    scheduledTasks,
    createScheduledTask,
    deleteScheduledTask,
    pauseScheduledTask,
    resumeScheduledTask,
  } = socketData;

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('ccplus_selected_model') || 'claude-sonnet-4-6';
  });

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem('ccplus_sidebar_width');
    return stored ? parseInt(stored, 10) : 260;
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
        // Silently fail, default to not showing welcome screen
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
        // Silently fail, version display is optional
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
  }, [workspace, activeProject]);

  const handleNewTerminalTab = useCallback(() => {
    if (!activeProject) return;
    workspace.addTerminalTab(activeProject.path);
    setShowDashboard(false);
  }, [workspace, activeProject]);

  const handleNewTabForProject = useCallback((projectPath: string) => {
    workspace.addTab(projectPath);
    setShowDashboard(false);
  }, [workspace]);

  const handleLoadSession = useCallback((sessionId: string) => {
    if (!activeProject) return;
    workspace.addTab(activeProject.path, sessionId);
    setShowDashboard(false);
  }, [activeProject, workspace]);

  const handleCloseTabInActiveProject = useCallback((sessionId: string) => {
    if (!activeProject) return;
    workspace.closeTab(activeProject.path, sessionId);
  }, [workspace, activeProject]);

  const handleCloseTab = useCallback((projectPath: string, sessionId: string) => {
    workspace.closeTab(projectPath, sessionId);
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
  const mruCycleIndexRef = useRef<number>(0);
  const isCyclingRef = useRef<boolean>(false);
  const mruSnapshotRef = useRef<string[]>([]);
  const mruSnapshotProjectRef = useRef<string>('');

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
  });

  useEffect(() => {
    if (!activeProject || !activeTab) return;
    workspace.setTabStreaming(activeProject.path, activeTab.sessionId, streaming);
  }, [streaming, activeProject, activeTab, workspace]);

  // Keyboard shortcuts (Cmd+T new tab, Cmd+W close tab, Cmd+K command palette, Escape cancel, Ctrl+Tab MRU tab switching)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K: Open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      // Cmd+T / Ctrl+T: New tab (works even with zero tabs if project is selected)
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        if (activeProject) {
          handleNewTab();
        }
        return;
      }

      // Cmd+W / Ctrl+W: Close current tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTab) {
          handleCloseTabInActiveProject(activeTab.sessionId);
        }
        return;
      }

      // Escape: Close command palette, active page (profile, insights), or cancel streaming query
      if (e.key === 'Escape') {
        if (showCommandPalette) {
          e.preventDefault();
          setShowCommandPalette(false);
          return;
        }
        if (activePage) {
          e.preventDefault();
          setActivePage(null);
          return;
        }
        if (streaming) {
          e.preventDefault();
          cancelQuery();
          return;
        }
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: MRU tab switching (cycles through tabs by recency, then crosses projects)
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();

        const projects = workspace.state.projects;
        if (projects.length === 0 || !activeProject) return;

        const forward = !e.shiftKey;

        if (!isCyclingRef.current) {
          // Start new cycle: snapshot current project's MRU order
          isCyclingRef.current = true;
          mruCycleIndexRef.current = 0;
          const mru = ensureMruOrder(activeProject.tabs, activeProject.tabMruOrder);
          mruSnapshotRef.current = mru;
          mruSnapshotProjectRef.current = activeProject.path;
        }

        // If we switched projects during cycling, snapshot that project's MRU
        if (mruSnapshotProjectRef.current !== activeProject.path) {
          const mru = ensureMruOrder(activeProject.tabs, activeProject.tabMruOrder);
          mruSnapshotRef.current = mru;
          mruSnapshotProjectRef.current = activeProject.path;
          mruCycleIndexRef.current = forward ? 0 : mru.length - 1;
        }

        const snapshot = mruSnapshotRef.current;
        const rawNext = forward
          ? mruCycleIndexRef.current + 1
          : mruCycleIndexRef.current - 1;

        if (rawNext >= 0 && rawNext < snapshot.length) {
          // Still within current project's MRU
          mruCycleIndexRef.current = rawNext;
          handleSelectTabInActiveProjectQuiet(snapshot[rawNext]);
        } else {
          // Try to cross to next/previous project, skipping projects with no tabs
          let crossed = false;
          if (projects.length > 1) {
            const projectIndex = projects.findIndex(p => p.path === activeProject.path);
            for (let i = 1; i < projects.length; i++) {
              const candidateIndex = forward
                ? (projectIndex + i) % projects.length
                : (projectIndex - i + projects.length) % projects.length;
              const candidateProject = projects[candidateIndex];
              const candidateMru = ensureMruOrder(candidateProject.tabs, candidateProject.tabMruOrder);
              if (candidateMru.length > 0) {
                const targetIdx = forward ? 0 : candidateMru.length - 1;
                mruSnapshotRef.current = candidateMru;
                mruSnapshotProjectRef.current = candidateProject.path;
                mruCycleIndexRef.current = targetIdx;
                handleSelectTabQuiet(candidateProject.path, candidateMru[targetIdx]);
                crossed = true;
                break;
              }
            }
          }
          if (!crossed && snapshot.length > 0) {
            // Wrap around within current project
            const wrappedIndex = forward ? 0 : snapshot.length - 1;
            mruCycleIndexRef.current = wrappedIndex;
            handleSelectTabInActiveProjectQuiet(snapshot[wrappedIndex]);
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && isCyclingRef.current) {
        // Commit the final tab selection to MRU
        if (activeProject && activeTab) {
          workspace.selectTab(activeProject.path, activeTab.sessionId);
        }
        isCyclingRef.current = false;
        mruCycleIndexRef.current = 0;
        mruSnapshotRef.current = [];
        mruSnapshotProjectRef.current = '';
      }
    };

    // Electron menu integration
    const electronAPI = (window as WindowWithElectron).electronAPI;
    const handleMenuAction = (_event: unknown, action: string) => {
      if (action === 'new-tab') handleNewTab();
      if (action === 'close-tab' && activeTab) {
        handleCloseTabInActiveProject(activeTab.sessionId);
      }
    };
    if (electronAPI?.onMenuAction) {
      electronAPI.onMenuAction(handleMenuAction);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (electronAPI?.removeMenuActionListener) {
        electronAPI.removeMenuActionListener(handleMenuAction);
      }
    };
  }, [activeProject, activeTab, workspace, workspace.state.projects, handleSelectTabInActiveProject, handleSelectTabInActiveProjectQuiet, handleSelectTab, handleSelectTabQuiet, handleNewTab, handleCloseTabInActiveProject, handleSelectProject, streaming, cancelQuery, activePage, showCommandPalette]);

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

  const contentMode = shouldShowWelcome ? 'welcome'
    : shouldShowInsights ? 'insights'
    : shouldShowProfile ? 'profile'
    : shouldShowMcp ? 'mcp'
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
        {activeProject && !activePage && (
          <TabBar
            tabs={activeProject.tabs}
            activeTabId={activeProject.activeTabId}
            onSelectTab={handleSelectTabInActiveProject}
            onNewTab={handleNewTab}
            onNewTerminalTab={handleNewTerminalTab}
            onCloseTab={handleCloseTabInActiveProject}
            onReopenTab={workspace.reopenTab}
            onCloseOtherTabs={(sessionId) => workspace.closeOtherTabs(activeProject.path, sessionId)}
            onDuplicateTab={handleDuplicateTab}
            onRenameTab={handleRenameTab}
            hasClosedTabs={workspace.hasClosedTabs}
          />
        )}
        <div className="panel-content">
          <div className={`panel-chat ${(shouldShowDashboard || shouldShowInsights || shouldShowProfile || shouldShowMcp || shouldShowWelcome) ? 'full-width' : ''}`}>
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
                <div style={{ display: activePage ? 'none' : 'flex', flexDirection: 'column' as const, flex: 1, minHeight: 0 }}>
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
              <ActivityTree tree={activityTree} usageStats={usageStats} contextTokens={contextTokens} />
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
