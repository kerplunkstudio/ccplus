import { useState, useCallback } from 'react';
import { useTabSocket } from './useTabSocket';

const getSessionId = (): string => {
  let sessionId = localStorage.getItem('ccplus_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('ccplus_session_id', sessionId);
  }
  return sessionId;
};

export function useSocket(token: string | null) {
  const [sessionId, setSessionId] = useState(getSessionId);
  const tabSocket = useTabSocket(token, sessionId);

  const switchSession = useCallback((newSessionId: string) => {
    localStorage.setItem('ccplus_session_id', newSessionId);
    setSessionId(newSessionId);
  }, []);

  const newSession = useCallback(() => {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('ccplus_session_id', id);
    setSessionId(id);
  }, []);

  return {
    ...tabSocket,
    sessionId,
    switchSession,
    newSession,
  };
}

export type { UsageStats } from '../types';
