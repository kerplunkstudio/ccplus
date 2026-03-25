import { useState, useEffect, useCallback } from 'react';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

export interface ToolRule {
  tool: string;
  action: 'allow' | 'warn' | 'block';
  condition?: string;
  message?: string;
}

export interface WorkflowTransition {
  from: string;
  to: string;
}

export interface WorkflowPhaseConfig {
  name: string;
  context?: string;
  agentHints?: string[];
  toolRules?: ToolRule[];
}

export interface WorkflowConfig {
  name: string;
  description?: string;
  builtin?: boolean;
  phases: WorkflowPhaseConfig[];
  transitions?: WorkflowTransition[];
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/workflows`);
      if (!res.ok) throw new Error('Failed to fetch workflows');
      const data = await res.json();
      setWorkflows(data.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/agents`);
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents || []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
    fetchAgents();
  }, [fetchWorkflows, fetchAgents]);

  const saveWorkflow = useCallback(async (workflow: WorkflowConfig): Promise<boolean> => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      if (!res.ok) throw new Error('Failed to save workflow');
      await fetchWorkflows();
      return true;
    } catch {
      return false;
    }
  }, [fetchWorkflows]);

  const deleteWorkflow = useCallback(async (name: string): Promise<boolean> => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/workflows/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return false;
      await fetchWorkflows();
      return true;
    } catch {
      return false;
    }
  }, [fetchWorkflows]);

  return {
    workflows,
    agents,
    loading,
    error,
    saveWorkflow,
    deleteWorkflow,
    refresh: fetchWorkflows,
  };
}
