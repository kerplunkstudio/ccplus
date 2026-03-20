import { useState, useEffect, useCallback } from 'react';
import { DecisionTrail } from '../types';

const API_BASE = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface UseDecisionTrailResult {
  trail: DecisionTrail | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDecisionTrail(sessionId: string | undefined): UseDecisionTrailResult {
  const [trail, setTrail] = useState<DecisionTrail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrail = useCallback(async () => {
    if (!sessionId) {
      setTrail(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/decision-trail`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Session not found');
        }
        throw new Error(`Failed to fetch decision trail: ${response.statusText}`);
      }

      const data = await response.json();
      setTrail(data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      setTrail(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTrail();
  }, [fetchTrail]);

  const refresh = useCallback(() => {
    fetchTrail();
  }, [fetchTrail]);

  return {
    trail,
    loading,
    error,
    refresh,
  };
}
