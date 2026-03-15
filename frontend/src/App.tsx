import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './hooks/useAuth';
import { useWorkspace } from './hooks/useWorkspace';
import { useTabSocket } from './hooks/useTabSocket';
import { ChatPanel } from './components/ChatPanel';
import { ActivityTree } from './components/ActivityTree';
import { ProjectDashboard } from './components/ProjectDashboard';
import ProjectSidebar from './components/ProjectSidebar';
import TabBar from './components/TabBar';
import { ThemeProvider } from './theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabState } from './types';
import './App.css';

const ensureMruOrder = (tabs: TabState[], mruOrder?: string[]): string[] => {
  const tabIds = new Set(tabs.map(t => t.sessionId));
  const valid = (mruOrder || []).filter(id => tabIds.has(id));
  const missing = tabs.filter(t => !valid.includes(t.sessionId)).map(t => t.sessionId);
  return [...valid, ...missing];
};

// Console easter egg
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  console.log(
    '%c CC+ %c Observability for Claude Code %c\n\n' +
    'You found the console. Respect.\n' +
    'github.com/mjfuentes/ccplus',
    'background: #22D3EE; color: #18181B; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px;',
    'background: #27272A; color: #E4E4E7; padding: 4px 8px; border-radius: 0 4px 4px 0;',
    ''
  );
}

interface AppContentProps {
  token: string | null;
  loading: boolean;
}

function AppContent({ token, loading }: AppContentProps) {
  const workspace = useWorkspace();
  const { activeProject, activeTab } = workspace;

  const {
    connected,
    messages,
    streaming,
    currentTool,
    activityTree,
    usageStats,
    toolLog,
    sendMessage,
    cancelQuery,
    pendingQuestion,
    respondToQuestion,
    isRestoringSession,
  } = useTabSocket(token, activeTab?.sessionId || '');

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('ccplus_selected_model') || 'claude-sonnet-4-20250514';
  });

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem('ccplus_sidebar_width');
    return stored ? parseInt(stored, 10) : 260;
  });

  const [mobileDrawer, setMobileDrawer] = useState<'sessions' | 'activity' | null>(null);

  const [showDashboard, setShowDashboard] = useState<boolean>(false);

  const handleSelectModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('ccplus_selected_model', model);
  };

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
  }, [workspace]);

  const handleSelectTab = useCallback((projectPath: string, sessionId: string) => {
    workspace.selectProject(projectPath);
    workspace.selectTab(projectPath, sessionId);
    setShowDashboard(false);
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
  const mruCycleIndexRef = useRef<number>(0);
  const isCyclingRef = useRef<boolean>(false);
  const mruSnapshotRef = useRef<string[]>([]);
  const mruSnapshotProjectRef = useRef<string>('');

  useEffect(() => {
    if (!activeProject || !activeTab || messages.length === 0) return;
    if (activeTab.label !== 'New session') return;
    if (lastLabeledSessionRef.current === activeTab.sessionId) return;

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
  }, [messages, activeProject, activeTab, workspace]);

  useEffect(() => {
    if (!activeProject || !activeTab) return;
    workspace.setTabStreaming(activeProject.path, activeTab.sessionId, streaming);
  }, [streaming, activeProject, activeTab, workspace]);

  // Keyboard shortcuts (Cmd+T new tab, Cmd+W close tab, Escape cancel, Ctrl+Tab MRU tab switching)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      // Escape: Cancel streaming query
      if (e.key === 'Escape' && streaming) {
        e.preventDefault();
        cancelQuery();
        return;
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
        const nextIndex = forward
          ? mruCycleIndexRef.current + 1
          : mruCycleIndexRef.current - 1;

        if (nextIndex >= 0 && nextIndex < snapshot.length) {
          // Still within current project's MRU
          mruCycleIndexRef.current = nextIndex;
          handleSelectTabInActiveProjectQuiet(snapshot[nextIndex]);
        } else {
          // Cross to next/previous project, skipping projects with no tabs
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
              break;
            }
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
    const electronAPI = (window as any).electronAPI;
    const handleMenuAction = (_event: any, action: string) => {
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
  }, [activeProject, activeTab, workspace, workspace.state.projects, handleSelectTabInActiveProject, handleSelectTabInActiveProjectQuiet, handleSelectTab, handleSelectTabQuiet, handleNewTab, handleCloseTabInActiveProject, handleSelectProject, streaming, cancelQuery]);

  const handleSendMessage = useCallback((content: string, workspace?: string, model?: string, imageIds?: string[]) => {
    sendMessage(content, workspace || activeProject?.path || undefined, model || selectedModel, imageIds);
  }, [sendMessage, activeProject, selectedModel]);

  const toggleDrawer = useCallback((drawer: 'sessions' | 'activity') => {
    setMobileDrawer((prev) => (prev === drawer ? null : drawer));
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Connecting...</p>
      </div>
    );
  }

  const hasTabs = activeProject && activeProject.tabs.length > 0;
  const shouldShowDashboard = activeProject && (showDashboard || !hasTabs);
  const shouldShowChatPanel = activeProject && hasTabs && !showDashboard;

  return (
    <div className="app-layout" style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      {mobileDrawer && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileDrawer(null)}
          aria-hidden="true"
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
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={handleSidebarWidthChange}
        />
      </div>

      <div className="panel-main">
        {activeProject && hasTabs && (
          <TabBar
            tabs={activeProject.tabs}
            activeTabId={activeProject.activeTabId}
            onSelectTab={handleSelectTabInActiveProject}
            onNewTab={handleNewTab}
            onCloseTab={handleCloseTabInActiveProject}
          />
        )}
        <div className="panel-content">
          <div className={`panel-chat ${shouldShowDashboard ? 'full-width' : ''}`}>
            {activeProject ? (
              shouldShowDashboard ? (
                <ProjectDashboard
                  projectPath={activeProject.path}
                  projectName={activeProject.name}
                  onNewSession={handleNewTab}
                  onLoadSession={handleLoadSession}
                />
              ) : shouldShowChatPanel ? (
                <ChatPanel
                  messages={messages}
                  connected={connected}
                  streaming={streaming}
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
                />
              ) : null
            ) : (
              <div className="no-project-state">
                <p>Open a project from the sidebar to get started</p>
              </div>
            )}
          </div>
          {shouldShowChatPanel && (
            <div className={`panel-activity ${mobileDrawer === 'activity' ? 'mobile-open' : ''}`}>
              <ActivityTree tree={activityTree} usageStats={usageStats} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const { token, loading } = useAuth();

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppContent token={token} loading={loading} />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
