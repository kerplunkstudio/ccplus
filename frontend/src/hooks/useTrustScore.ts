import { useState, useEffect, useRef } from 'react';
import { TrustMetrics } from '../types/index';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

export function useTrustScore(sessionId: string | undefined) {
  const [trustScore, setTrustScore] = useState<TrustMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, TrustMetrics>>(new Map());

  const fetchTrustScore = async (id: string) => {
    if (cacheRef.current.has(id)) {
      setTrustScore(cacheRef.current.get(id)!);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${SOCKET_URL}/api/sessions/${id}/trust-score`);
      const json = await response.json();
      if (!response.ok || !json.success) {
        setError(json.error || 'Failed to load trust score');
        setTrustScore(null);
      } else {
        cacheRef.current.set(id, json.data);
        setTrustScore(json.data);
      }
    } catch (err) {
      setError('Network error loading trust score');
      setTrustScore(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionId) {
      fetchTrustScore(sessionId);
    } else {
      setTrustScore(null);
    }
  }, [sessionId]);

  const refetch = () => {
    if (sessionId) {
      cacheRef.current.delete(sessionId);
      fetchTrustScore(sessionId);
    }
  };

  return { trustScore, loading, error, refetch };
}
