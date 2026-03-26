import { useEffect, useRef } from 'react';
import { ProjectEntry, TabState, WindowWithElectron } from '../types';

interface UseKeyboardShortcutsProps {
  activeProject: ProjectEntry | null;
  activeTab: TabState | null;
  projects: ProjectEntry[];
  showCommandPalette: boolean;
  activePage: string | null;
  streaming: boolean;
  pageTabsOpen: string[];
  handleNewTab: () => void;
  handleCloseTabInActiveProject: (sessionId: string) => void;
  handleClosePageTab: (page: string) => void;
  handleSelectTabInActiveProjectQuiet: (sessionId: string) => void;
  handleSelectTabQuiet: (projectPath: string, sessionId: string) => void;
  setShowCommandPalette: (show: boolean) => void;
  setActivePage: (page: string | null) => void;
  onCaptainClick: () => void;
  cancelQuery: () => void;
  onSelectTab: (projectPath: string, sessionId: string) => void;
}

export function useKeyboardShortcuts({
  activeProject,
  activeTab,
  projects,
  showCommandPalette,
  activePage,
  streaming,
  pageTabsOpen,
  handleNewTab,
  handleCloseTabInActiveProject,
  handleClosePageTab,
  handleSelectTabInActiveProjectQuiet,
  handleSelectTabQuiet,
  setShowCommandPalette,
  setActivePage,
  onCaptainClick,
  cancelQuery,
  onSelectTab,
}: UseKeyboardShortcutsProps) {
  const isCyclingRef = useRef<boolean>(false);

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

      // Ctrl+Tab / Ctrl+Shift+Tab: Visual order tab cycling (Captain → page tabs → session tabs → wrap)
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();

        if (!activeProject) return;

        const forward = !e.shiftKey;
        isCyclingRef.current = true;

        // Build unified tab list in visual order: ['captain', ...pageTabsOpen, ...sessionIds]
        const sessionIds = activeProject.tabs.map(tab => tab.sessionId); // Extract session IDs from TabState array
        const allTabs = ['captain', ...pageTabsOpen, ...sessionIds];

        if (allTabs.length === 0) return;

        // Find current position
        let currentIndex = 0;
        if (activePage === 'captain') {
          currentIndex = 0;
        } else if (activePage && pageTabsOpen.includes(activePage)) {
          currentIndex = 1 + pageTabsOpen.indexOf(activePage);
        } else if (activePage === null && activeTab) {
          const sessionIndex = sessionIds.indexOf(activeTab.sessionId);
          if (sessionIndex !== -1) {
            currentIndex = 1 + pageTabsOpen.length + sessionIndex;
          }
        }

        // Move to next/previous tab with wrapping
        const nextIndex = forward
          ? (currentIndex + 1) % allTabs.length
          : (currentIndex - 1 + allTabs.length) % allTabs.length;

        const targetTab = allTabs[nextIndex];

        // Activate target
        if (targetTab === 'captain') {
          onCaptainClick();
        } else if (pageTabsOpen.includes(targetTab)) {
          setActivePage(targetTab);
        } else {
          // It's a session ID
          handleSelectTabInActiveProjectQuiet(targetTab);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && isCyclingRef.current) {
        // Commit the final tab selection to MRU (only needed for session tabs)
        if (activeProject && activeTab && activePage === null) {
          onSelectTab(activeProject.path, activeTab.sessionId);
        }
        isCyclingRef.current = false;
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
    streaming,
    pageTabsOpen,
    handleNewTab,
    handleCloseTabInActiveProject,
    handleClosePageTab,
    handleSelectTabInActiveProjectQuiet,
    handleSelectTabQuiet,
    setShowCommandPalette,
    setActivePage,
    onCaptainClick,
    cancelQuery,
    onSelectTab,
  ]);
}
