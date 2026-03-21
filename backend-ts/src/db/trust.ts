import { getDb } from "./connection.js";

export function getSessionTrustData(sessionId: string): {
  tools: Array<{
    tool_name: string;
    parameters: string;
    success: number;
    error?: string | null;
    timestamp: string;
    parent_agent_id?: string | null;
  }>;
  queries: Array<{
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    timestamp: string;
  }>;
  conversations: Array<{
    role: string;
    content: string;
    timestamp: string;
    project_path?: string | null;
  }>;
} {
  const d = getDb();

  const tools = d.prepare(`
    SELECT tool_name, parameters, success, error, timestamp, parent_agent_id
    FROM tool_usage
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<{
    tool_name: string;
    parameters: string;
    success: number;
    error?: string | null;
    timestamp: string;
    parent_agent_id?: string | null;
  }>;

  const queries = d.prepare(`
    SELECT
      (input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens) as total_tokens,
      input_tokens,
      output_tokens,
      cost_usd,
      timestamp
    FROM query_usage
    WHERE session_id = ?
  `).all(sessionId) as Array<{
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    timestamp: string;
  }>;

  const conversations = d.prepare(`
    SELECT role, content, timestamp, project_path
    FROM conversations
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<{
    role: string;
    content: string;
    timestamp: string;
    project_path?: string | null;
  }>;

  return { tools, queries, conversations };
}
