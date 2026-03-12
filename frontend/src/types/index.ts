export interface Message {
  id: string;
  content?: string;
  role: 'user' | 'assistant';
  timestamp: number;
  streaming?: boolean;
  tool?: {
    tool_name: string;
    agent_type?: string;
    parameters?: Record<string, unknown>;
    status: string;
    duration_ms?: number;
    error?: string;
  };
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
  status: 'running' | 'completed' | 'failed';
  duration_ms?: number;
  error?: string;
}

export interface ToolNode {
  tool_use_id: string;
  tool_name: string;
  timestamp: string;
  status: 'running' | 'completed' | 'failed';
  duration_ms?: number;
  error?: string;
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

export interface CompletionInfo {
  cost?: number;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface UsageStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDuration: number;
  queryCount: number;
}
