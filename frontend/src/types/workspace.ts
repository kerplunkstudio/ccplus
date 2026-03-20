export interface TabState {
  sessionId: string;
  label: string;
  isStreaming: boolean;
  hasRunningAgent: boolean;
  createdAt: number;
  type?: 'chat' | 'browser' | 'terminal';
  url?: string;
  projectPath?: string;
}

export interface ProjectEntry {
  path: string;
  name: string;
  tabs: TabState[];
  activeTabId: string;
  tabMruOrder?: string[];
}

export interface WorkspaceState {
  projects: ProjectEntry[];
  activeProjectPath: string | null;
}

export type WorkspaceAction =
  | { type: 'ADD_PROJECT'; path: string; name: string }
  | { type: 'REMOVE_PROJECT'; path: string }
  | { type: 'SELECT_PROJECT'; path: string }
  | { type: 'ADD_TAB'; projectPath: string; sessionId: string; label?: string }
  | { type: 'ADD_BROWSER_TAB'; projectPath: string; sessionId: string; url: string; label: string }
  | { type: 'ADD_TERMINAL_TAB'; projectPath: string; sessionId: string; label: string }
  | { type: 'CLOSE_TAB'; projectPath: string; sessionId: string }
  | { type: 'CLOSE_OTHER_TABS'; projectPath: string; sessionId: string }
  | { type: 'REOPEN_TAB'; projectPath: string; tab: TabState; position?: number }
  | { type: 'SELECT_TAB'; projectPath: string; sessionId: string }
  | { type: 'SELECT_TAB_QUIET'; projectPath: string; sessionId: string }
  | { type: 'UPDATE_TAB_LABEL'; projectPath: string; sessionId: string; label: string }
  | { type: 'SET_TAB_STREAMING'; projectPath: string; sessionId: string; streaming: boolean }
  | { type: 'SET_TAB_RUNNING'; projectPath: string; sessionId: string; running: boolean }
  | { type: 'RESTORE'; state: WorkspaceState };
