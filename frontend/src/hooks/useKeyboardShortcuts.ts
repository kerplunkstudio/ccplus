import { useEffect, useRef } from 'react';
import { ProjectEntry, TabState, WindowWithElectron } from '../types';
import { ensureMruOrder } from '../utils/tabs';

interface UseKeyboardShortcutsProps {
  activeProject: ProjectEntry | null;
  activeTab: TabState | null;
  projects: ProjectEntry[];
  showCommandPalette: boolean;
  activePage: string | null;
  openPageTabs: string[];
  streaming: boolean;
  handleNewTab: () => void;
  handleCloseTabInActiveProject: (sessionId: string) => void;
  handleClosePageTab: (page: string) => void;
  handleSelectTabInActiveProjectQuiet: (sessionId: string) => void;
  handleSelectTabQuiet: (projectPath: string, sessionId: string) => void;
  setShowCommandPalette: (show: boolean) => void;
  setActivePage: (page: string | null) => void;
  cancelQuery: () => void;
  onSelectTab: (projectPath: string, sessionId: string) => void;
}

export function useKeyboardShortcuts({
  activeProject,
  activeTab,
  projects,
  showCommandPalette,
  activePage,
  openPageTabs,
  streaming,
  handleNewTab,
  handleCloseTabInActiveProject,
  handleClosePageTab,
  handleSelectTabInActiveProjectQuiet,
  handleSelectTabQuiet,
  setShowCommandPalette,
  setActivePage,
  cancelQuery,
  onSelectTab,
}: UseKeyboardShortcutsProps) {
  const isCyclingRef = useRef<boolean>(false);
  const unifiedTabsSnapshotRef = useRef<Array<{ type: 'captain' | 'page' | 'session', id: string, projectPath?: string }>>([]);

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

      // Cmd+W / Ctrl+W: Close current tab or page tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activePage) {
          handleClosePageTab(activePage);
        } else if (activeTab) {
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

      // Ctrl+Tab / Ctrl+Shift+Tab: Unified tab switching (captain → page tabs → session tabs → wrap)
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();

        const forward = !e.shiftKey;

        if (!isCyclingRef.current) {
          // Start new cycle: build unified tab list
          isCyclingRef.current = true;

          // Build unified list: ['captain', ...openPageTabs, ...allSessionTabsInMRU]
          const unifiedTabs: Array<{ type: 'captain' | 'page' | 'session', id: string, projectPath?: string }> = [];

          // Always start with captain
          unifiedTabs.push({ type: 'captain', id: 'captain' });

          // Add open page tabs
          for (const pageId of openPageTabs) {
            unifiedTabs.push({ type: 'page', id: pageId });
          }

          // Add all session tabs across all projects in MRU order
          // Collect all session tabs with their MRU positions
          const allSessionTabs: Array<{ sessionId: string, projectPath: string, mruIndex: number }> = [];
          for (const project of projects) {
            const mru = ensureMruOrder(project.tabs, project.tabMruOrder);
            for (let i = 0; i < mru.length; i++) {
              allSessionTabs.push({ sessionId: mru[i], projectPath: project.path, mruIndex: i });
            }
          }

          // Sort by MRU index (most recent first)
          allSessionTabs.sort((a, b) => a.mruIndex - b.mruIndex);

          // Add to unified list
          for (const tab of allSessionTabs) {
            unifiedTabs.push({ type: 'session', id: tab.sessionId, projectPath: tab.projectPath });
          }

          unifiedTabsSnapshotRef.current = unifiedTabs;
        }

        const snapshot = unifiedTabsSnapshotRef.current;
        if (snapshot.length === 0) return;

        // Find current index in unified list
        let currentIndex = 0;
        if (activePage === 'captain') {
          currentIndex = 0;
        } else if (activePage && openPageTabs.includes(activePage)) {
          currentIndex = 1 + openPageTabs.indexOf(activePage);
        } else if (activePage === null && activeTab) {
          // Find session tab in unified list
          const idx = snapshot.findIndex(t => t.type === 'session' && t.id === activeTab.sessionId);
          currentIndex = idx !== -1 ? idx : 0;
        }

        // Navigate forward or backward with wrap-around
        const nextIndex = forward
          ? (currentIndex + 1) % snapshot.length
          : (currentIndex - 1 + snapshot.length) % snapshot.length;

        const target = snapshot[nextIndex];

        // Navigate to the target
        if (target.type === 'captain') {
          setActivePage('captain');
        } else if (target.type === 'page') {
          setActivePage(target.id);
        } else if (target.type === 'session' && target.projectPath) {
          // Navigate to session tab
          setActivePage(null);
          if (activeProject?.path === target.projectPath) {
            handleSelectTabInActiveProjectQuiet(target.id);
          } else {
            handleSelectTabQuiet(target.projectPath, target.id);
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && isCyclingRef.current) {
        // Commit the final tab selection to MRU only if we landed on a session tab
        if (activePage === null && activeProject && activeTab) {
          onSelectTab(activeProject.path, activeTab.sessionId);
        }
        isCyclingRef.current = false;
        unifiedTabsSnapshotRef.current = [];
      }
    };

    // Electron menu integration
    const electronAPI = (window as WindowWithElectron).electronAPI;
    const handleMenuAction = (_event: unknown, action: string) => {
      if (action === 'new-tab') handleNewTab();
      if (action === 'close-tab') {
        if (activePage) {
          handleClosePageTab(activePage);
        } else if (activeTab) {
          handleCloseTabInActiveProject(activeTab.sessionId);
        }
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
  }, [
    activeProject,
    activeTab,
    projects,
    showCommandPalette,
    activePage,
    openPageTabs,
    streaming,
    handleNewTab,
    handleCloseTabInActiveProject,
    handleClosePageTab,
    handleSelectTabInActiveProjectQuiet,
    handleSelectTabQuiet,
    setShowCommandPalette,
    setActivePage,
    cancelQuery,
    onSelectTab,
  ]);
}
