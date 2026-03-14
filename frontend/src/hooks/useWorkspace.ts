import { useReducer, useEffect, useCallback, useRef } from 'react';
import { WorkspaceState, WorkspaceAction, ProjectEntry, TabState } from '../types';

const STORAGE_KEY = 'ccplus_workspace';
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || window.location.origin;

const generateSessionId = (): string =>
  `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const updateProject = (
  state: WorkspaceState,
  projectPath: string,
  updater: (project: ProjectEntry) => ProjectEntry
): WorkspaceState => ({
  ...state,
  projects: state.projects.map((p) =>
    p.path === projectPath ? updater(p) : p
  ),
});

const updateTab = (
  project: ProjectEntry,
  sessionId: string,
  updater: (tab: TabState) => TabState
): ProjectEntry => ({
  ...project,
  tabs: project.tabs.map((t) =>
    t.sessionId === sessionId ? updater(t) : t
  ),
});

const workspaceReducer = (state: WorkspaceState, action: WorkspaceAction): WorkspaceState => {
  switch (action.type) {
    case 'ADD_PROJECT': {
      if (state.projects.some((p) => p.path === action.path)) {
        return state;
      }
      const newTab: TabState = {
        sessionId: generateSessionId(),
        label: 'New session',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
      };
      const newProject: ProjectEntry = {
        path: action.path,
        name: action.name,
        tabs: [newTab],
        activeTabId: newTab.sessionId,
      };
      return {
        ...state,
        projects: [...state.projects, newProject],
        activeProjectPath: newProject.path,
      };
    }

    case 'REMOVE_PROJECT': {
      const filtered = state.projects.filter((p) => p.path !== action.path);
      return {
        ...state,
        projects: filtered,
        activeProjectPath: state.activeProjectPath === action.path
          ? (filtered.length > 0 ? filtered[0].path : null)
          : state.activeProjectPath,
      };
    }

    case 'SELECT_PROJECT':
      return {
        ...state,
        activeProjectPath: action.path,
      };

    case 'ADD_TAB': {
      return updateProject(state, action.projectPath, (project) => {
        const newTab: TabState = {
          sessionId: action.sessionId,
          label: 'New session',
          isStreaming: false,
          hasRunningAgent: false,
          createdAt: Date.now(),
        };
        return {
          ...project,
          tabs: [...project.tabs, newTab],
          activeTabId: newTab.sessionId,
        };
      });
    }

    case 'CLOSE_TAB': {
      return updateProject(state, action.projectPath, (project) => {
        const filtered = project.tabs.filter((t) => t.sessionId !== action.sessionId);

        if (filtered.length === 0) {
          const freshTab: TabState = {
            sessionId: generateSessionId(),
            label: 'New session',
            isStreaming: false,
            hasRunningAgent: false,
            createdAt: Date.now(),
          };
          return {
            ...project,
            tabs: [freshTab],
            activeTabId: freshTab.sessionId,
          };
        }

        return {
          ...project,
          tabs: filtered,
          activeTabId: project.activeTabId === action.sessionId
            ? filtered[filtered.length - 1].sessionId
            : project.activeTabId,
        };
      });
    }

    case 'SELECT_TAB':
      return updateProject(state, action.projectPath, (project) => ({
        ...project,
        activeTabId: action.sessionId,
      }));

    case 'UPDATE_TAB_LABEL':
      return updateProject(state, action.projectPath, (project) =>
        updateTab(project, action.sessionId, (tab) => ({
          ...tab,
          label: action.label,
        }))
      );

    case 'SET_TAB_STREAMING':
      return updateProject(state, action.projectPath, (project) =>
        updateTab(project, action.sessionId, (tab) => ({
          ...tab,
          isStreaming: action.streaming,
        }))
      );

    case 'SET_TAB_RUNNING':
      return updateProject(state, action.projectPath, (project) =>
        updateTab(project, action.sessionId, (tab) => ({
          ...tab,
          hasRunningAgent: action.running,
        }))
      );

    case 'RESTORE':
      return action.state;

    default:
      return state;
  }
};

const loadInitialState = (): WorkspaceState => {
  // Start with localStorage as fast cache, will be overridden by API fetch
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Fall through to default
  }
  return { projects: [], activeProjectPath: null };
};

const stripTransientFields = (state: WorkspaceState): WorkspaceState => ({
  ...state,
  projects: state.projects.map((p) => ({
    ...p,
    tabs: p.tabs.map((t) => ({
      ...t,
      isStreaming: false,
      hasRunningAgent: false,
    })),
  })),
});

export function useWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, null, loadInitialState);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  const latestStateRef = useRef<WorkspaceState>(state);

  // Fetch workspace from API on mount (source of truth for cross-client sync)
  useEffect(() => {
    fetch(`${SOCKET_URL}/api/workspace`)
      .then((res) => (res.ok ? res.json() : null))
      .then((apiState) => {
        if (apiState && apiState.projects && apiState.projects.length > 0) {
          // Compare timestamps: localStorage might be newer (e.g., after hard refresh where
          // sendBeacon races with the GET request)
          const localSavedAt = (state as any).savedAt || 0;
          const apiSavedAt = apiState.savedAt || 0;

          if (apiSavedAt >= localSavedAt) {
            // API is same age or newer — use it as source of truth
            dispatch({ type: 'RESTORE', state: apiState });
          }
          // else: localStorage is newer — keep current state, re-sync API
        } else if (state.projects.length > 0) {
          // API is empty but localStorage has data — bootstrap the API
          const persistable = stripTransientFields(state);
          fetch(`${SOCKET_URL}/api/workspace`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...persistable, savedAt: Date.now() }),
          }).catch(() => {});
        }
        initializedRef.current = true;
      })
      .catch(() => {
        initializedRef.current = true;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush workspace state on beforeunload to prevent loss during debounce window
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Cancel any pending debounced save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      // Only send if initialized
      if (!initializedRef.current) return;

      // Use sendBeacon for guaranteed delivery during page unload
      // It survives even when the page is being torn down
      const payload = { ...latestStateRef.current, savedAt: Date.now() };
      const blob = new Blob(
        [JSON.stringify(payload)],
        { type: 'application/json' }
      );

      navigator.sendBeacon(`${SOCKET_URL}/api/workspace`, blob);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Save to localStorage immediately + debounced API save on every change
  useEffect(() => {
    // Always save to localStorage for fast same-browser reload
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));

    // Update ref with stripped state for beforeunload handler
    const persistable = stripTransientFields(state);
    latestStateRef.current = persistable;

    // Don't save back to API until we've loaded from it first
    if (!initializedRef.current) return;

    // Debounced save to API (300ms) to avoid hammering on rapid changes
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      const withTimestamp = { ...persistable, savedAt: Date.now() };
      fetch(`${SOCKET_URL}/api/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withTimestamp),
      }).catch(() => {
        // Best-effort save, localStorage is the fallback
      });
    }, 300);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [state]);

  const activeProject = state.projects.find((p) => p.path === state.activeProjectPath) || null;
  const activeTab = activeProject?.tabs.find((t) => t.sessionId === activeProject.activeTabId) || null;

  const addProject = useCallback((path: string, name: string) => {
    dispatch({ type: 'ADD_PROJECT', path, name });
  }, []);

  const removeProject = useCallback((path: string) => {
    dispatch({ type: 'REMOVE_PROJECT', path });
  }, []);

  const selectProject = useCallback((path: string) => {
    dispatch({ type: 'SELECT_PROJECT', path });
  }, []);

  const addTab = useCallback((projectPath: string, sessionId?: string) => {
    const newSessionId = sessionId || generateSessionId();
    dispatch({ type: 'ADD_TAB', projectPath, sessionId: newSessionId });
  }, []);

  const closeTab = useCallback((projectPath: string, sessionId: string) => {
    dispatch({ type: 'CLOSE_TAB', projectPath, sessionId });
  }, []);

  const selectTab = useCallback((projectPath: string, sessionId: string) => {
    dispatch({ type: 'SELECT_TAB', projectPath, sessionId });
  }, []);

  const updateTabLabel = useCallback((projectPath: string, sessionId: string, label: string) => {
    dispatch({ type: 'UPDATE_TAB_LABEL', projectPath, sessionId, label });
  }, []);

  const setTabStreaming = useCallback((projectPath: string, sessionId: string, streaming: boolean) => {
    dispatch({ type: 'SET_TAB_STREAMING', projectPath, sessionId, streaming });
  }, []);

  const setTabRunning = useCallback((projectPath: string, sessionId: string, running: boolean) => {
    dispatch({ type: 'SET_TAB_RUNNING', projectPath, sessionId, running });
  }, []);

  return {
    state,
    activeProject,
    activeTab,
    addProject,
    removeProject,
    selectProject,
    addTab,
    closeTab,
    selectTab,
    updateTabLabel,
    setTabStreaming,
    setTabRunning,
  };
}
