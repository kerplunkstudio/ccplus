export interface ImageAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  url: string;
}

export interface Message {
  id: string;
  content?: string;
  role: 'user' | 'assistant';
  timestamp: number;
  streaming?: boolean;
  toolLog?: ToolEvent[];
  images?: ImageAttachment[];
  isCompactBoundary?: boolean;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface ToolEvent {
  type: 'tool_start' | 'tool_complete' | 'agent_start' | 'agent_stop' | 'todo_update';
  tool_name: string;
  tool_use_id: string;
  parent_agent_id: string | null;
  agent_type?: string;
  description?: string;
  timestamp: string;
  success?: boolean;
  error?: string;
  duration_ms?: number;
  parameters?: Record<string, unknown>;
  session_id?: string;
  transcript_path?: string | null;
  summary?: string | null;
}

export interface AgentNode {
  tool_use_id: string;
  agent_type: string;
  tool_name: string;
  description?: string;
  timestamp: string;
  children: ActivityNode[];
  status: 'running' | 'completed' | 'failed' | 'stopped';
  duration_ms?: number;
  error?: string;
  sequence?: number;
  transcript_path?: string | null;
  summary?: string | null;
}

export interface ToolNode {
  tool_use_id: string;
  tool_name: string;
  timestamp: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  duration_ms?: number;
  error?: string;
  sequence?: number;
  parameters?: Record<string, unknown>;
  parent_agent_id: string | null;
  elapsed_seconds?: number;
}

export type ActivityNode = AgentNode | ToolNode;

export function isAgentNode(node: ActivityNode): node is AgentNode {
  return 'children' in node;
}

export interface User {
  id: string;
  username: string;
}

export interface UsageStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDuration: number;
  queryCount: number;
  contextWindowSize: number;
  model: string;
  linesOfCode: number;
  totalSessions: number;
}

export interface PluginAuthor {
  name: string;
  url?: string;
}

export interface Plugin {
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  repository: string;
  installed: boolean;
  install_path?: string;
  installed_at?: string;
  homepage?: string;
  license?: string;
  keywords?: string[];
  agents?: string[];
  skills?: string[];
  commands?: string[];
}

export interface PluginInstallResult {
  success: boolean;
  plugin?: string;
  version?: string;
  install_path?: string;
  error?: string;
}

export interface PluginUninstallResult {
  success: boolean;
  plugin?: string;
  error?: string;
}

export interface SignalStatus {
  phase: 'planning' | 'implementing' | 'testing' | 'reviewing' | 'debugging' | 'researching';
  detail?: string;
}

export interface SignalState {
  status: SignalStatus | null;
}

export interface PromptSuggestion {
  suggestions: string[];
  timestamp: number;
}

export interface RateLimitState {
  active: boolean;
  retryAfterMs: number;
  rateLimitedAt: string;
}

export interface PendingQuestion {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  toolUseId: string;
}

export interface ElectronAPI {
  onMenuAction?: (handler: (event: unknown, action: string) => void) => void;
  removeMenuActionListener?: (handler: (event: unknown, action: string) => void) => void;
  openExternal?: (url: string) => void;
}

export interface WindowWithElectron extends Window {
  electronAPI?: ElectronAPI;
}

export interface FileWithPath extends File {
  path?: string;
}

export interface MarkdownCodeProps {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}

export interface DBMessage {
  id: number;
  content: string;
  role: 'user' | 'assistant';
  timestamp: string;
}

export interface DBToolEvent {
  tool_name: string;
  tool_use_id: string;
  parent_agent_id: string | null;
  agent_type?: string;
  timestamp: string;
  success: boolean | null;
  error?: string | null;
  duration_ms?: number;
  parameters?: Record<string, unknown>;
  description?: string;
}

export interface SkillData {
  name: string;
  plugin: string;
  description?: string;
}

export interface NativeImage {
  toDataURL: () => string;
  toPNG: () => Buffer;
  toJPEG: (quality: number) => Buffer;
}

export interface WebViewElement extends HTMLElement {
  loadURL: (url: string) => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  getURL: () => string;
  capturePage: () => Promise<NativeImage>;
  addEventListener: (event: string, handler: (event?: unknown) => void) => void;
  removeEventListener: (event: string, handler: (event?: unknown) => void) => void;
}

export interface WebViewLoadFailEvent {
  errorDescription?: string;
}

export * from './workspace';
