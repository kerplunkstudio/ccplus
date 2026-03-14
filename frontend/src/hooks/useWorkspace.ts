import { useReducer, useEffect, useCallback } from 'react';
import { WorkspaceState, WorkspaceAction, ProjectEntry, TabState } from '../types';

const STORAGE_KEY = 'ccplus_workspace';
const OLD_PROJECT_KEY = 'ccplus_selected_project';
const OLD_SESSION_KEY = 'ccplus_session_id';

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
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }

    const oldProject = localStorage.getItem(OLD_PROJECT_KEY);
    const oldSession = localStorage.getItem(OLD_SESSION_KEY);

    if (oldProject && oldSession) {
      const projectData = JSON.parse(oldProject);
      const initialTab: TabState = {
        sessionId: oldSession,
        label: 'New session',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
      };
      const migratedProject: ProjectEntry = {
        path: projectData.path,
        name: projectData.name,
        tabs: [initialTab],
        activeTabId: initialTab.sessionId,
      };
      return {
        projects: [migratedProject],
        activeProjectPath: migratedProject.path,
      };
    }

    return { projects: [], activeProjectPath: null };
  } catch {
    return { projects: [], activeProjectPath: null };
  }
};

export function useWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, null, loadInitialState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
