import { useState, useEffect, useCallback } from 'react';
import { SOCKET_URL } from '../config';

export interface McpServer {
  name: string;
  scope: 'user' | 'project';
}

export function useMcpServers() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${SOCKET_URL}/api/mcp/servers`);
      if (!response.ok) {
        throw new Error('Failed to load MCP servers');
      }
      const data = await response.json();
      setServers(data.servers || []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  return {
    servers,
    loading,
    error,
    reload: loadServers,
  };
}
