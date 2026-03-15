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
}

export interface ToolEvent {
  type: 'tool_start' | 'tool_complete' | 'agent_start' | 'agent_stop';
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

export * from './workspace';
