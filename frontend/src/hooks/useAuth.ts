import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '../types';

const API_BASE = process.env.REACT_APP_API_URL || '';
const MAX_RETRY_DELAY = 5000;
const INITIAL_RETRY_DELAY = 1000;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const verifyToken = useCallback(async (t: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setToken(t);
        setLoading(false);
        retryCountRef.current = 0;
        return;
      }
      // Non-ok HTTP response (401, etc.) - don't retry, fall through to auto-login
      localStorage.removeItem('ccplus_token');
      autoLogin();
    } catch (error) {
      // Network error - backend not up yet, retry with backoff
      const delay = Math.min(INITIAL_RETRY_DELAY * (retryCountRef.current + 1), MAX_RETRY_DELAY);
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        verifyToken(t);
      }, delay);
    }
  }, []);

  const autoLogin = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/auto-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('ccplus_token', data.token);
        setUser(data.user);
        setToken(data.token);
        setLoading(false);
        retryCountRef.current = 0;
        return;
      }
      // Non-ok HTTP response - auth unavailable, continue without auth
      setLoading(false);
    } catch (error) {
      // Network error - backend not up yet, retry with backoff
      const delay = Math.min(INITIAL_RETRY_DELAY * (retryCountRef.current + 1), MAX_RETRY_DELAY);
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        autoLogin();
      }, delay);
    }
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem('ccplus_token');
    if (savedToken) {
      verifyToken(savedToken);
    } else {
      autoLogin();
    }

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [verifyToken, autoLogin]);

  const logout = useCallback(() => {
    localStorage.removeItem('ccplus_token');
    setUser(null);
    setToken(null);
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  return { user, token, loading, logout };
}
