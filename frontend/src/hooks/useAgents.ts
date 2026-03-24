import { useState, useEffect, useCallback } from 'react';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

export interface AgentSecurity {
  allowedTools?: string[];
  disallowedTools?: string[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  icon?: string;
  model?: string;
  maxTurns?: number;
  personality?: string;
  soulContent: string;
  security?: AgentSecurity;
  dirPath: string;
}

interface UseAgentsReturn {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAgents(): UseAgentsReturn {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${SOCKET_URL}/api/agents`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setAgents(data.agents || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to load agents: ${message}`);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return {
    agents,
    loading,
    error,
    refetch: fetchAgents,
  };
}
