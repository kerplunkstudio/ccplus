import { useEffect, useRef } from 'react';
import { ProjectEntry, TabState, WindowWithElectron } from '../types';
import { ensureMruOrder } from '../utils/tabs';

interface UseKeyboardShortcutsProps {
  activeProject: ProjectEntry | null;
  activeTab: TabState | null;
  projects: ProjectEntry[];
  showCommandPalette: boolean;
  activePage: string | null;
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
  const mruCycleIndexRef = useRef<number>(0);
  const isCyclingRef = useRef<boolean>(false);
  const mruSnapshotRef = useRef<string[]>([]);
  const mruSnapshotProjectRef = useRef<string>('');

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

      // Ctrl+Tab / Ctrl+Shift+Tab: MRU tab switching (cycles through tabs by recency, then crosses projects)
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();

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
          onSelectTab(activeProject.path, activeTab.sessionId);
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
