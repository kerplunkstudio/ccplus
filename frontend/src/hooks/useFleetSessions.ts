import { useState, useEffect, useCallback } from 'react';
import { FleetSession } from '../types';
import { SOCKET_URL } from '../config';

export interface UseFleetSessionsOptions {
  status?: string[];
  workspace?: string;
  workflowName?: string;
  page?: number;
  limit?: number;
  enabled?: boolean;
}

export interface FleetSessionsResponse {
  sessions: FleetSession[];
  total: number;
  page: number;
  limit: number;
}

export interface FleetFiltersResponse {
  statuses: string[];
  workspaces: string[];
  workflowNames: string[];
}

interface UseFleetSessionsResult {
  sessions: FleetSession[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useFleetSessions(options: UseFleetSessionsOptions = {}): UseFleetSessionsResult {
  const {
    status = [],
    workspace,
    workflowName,
    page = 1,
    limit = 20,
    enabled = true,
  } = options;

  const [sessions, setSessions] = useState<FleetSession[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(page);
  const [currentLimit, setCurrentLimit] = useState(limit);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (status.length > 0) {
        params.append('status', status.join(','));
      }
      if (workspace) {
        params.append('project', workspace);
      }
      if (workflowName) {
        params.append('workflow', workflowName);
      }
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const url = `${SOCKET_URL}/api/fleet/sessions?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch sessions: ${response.statusText}`);
      }

      const data: FleetSessionsResponse = await response.json();

      setSessions(data.sessions);
      setTotal(data.total);
      setCurrentPage(data.page);
      setCurrentLimit(data.limit);
    } catch (err) {
      const error = err as Error;
      setError(error);
      setSessions([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, status, workspace, workflowName, page, limit]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return {
    sessions,
    total,
    page: currentPage,
    limit: currentLimit,
    isLoading,
    error,
    refetch: fetchSessions,
  };
}

export function useFleetFilters(enabled: boolean = true): {
  filters: FleetFiltersResponse | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [filters, setFilters] = useState<FleetFiltersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const fetchFilters = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const url = `${SOCKET_URL}/api/fleet/filters`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch filters: ${response.statusText}`);
        }

        const data: FleetFiltersResponse = await response.json();
        setFilters(data);
      } catch (err) {
        const error = err as Error;
        setError(error);
        setFilters(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFilters();
  }, [enabled]);

  return { filters, isLoading, error };
}
