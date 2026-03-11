import { useState, useEffect, useCallback } from 'react';
import { User } from '../types';

const API_BASE = process.env.REACT_APP_API_URL || '';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        return;
      }
    } catch {
      // Fall through to auto-login
    }
    localStorage.removeItem('ccplus_token');
    autoLogin();
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
      }
    } catch (e) {
      // Auto-login unavailable, continue without auth
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem('ccplus_token');
    if (savedToken) {
      verifyToken(savedToken);
    } else {
      autoLogin();
    }
  }, [verifyToken, autoLogin]);

  const logout = useCallback(() => {
    localStorage.removeItem('ccplus_token');
    setUser(null);
    setToken(null);
  }, []);

  return { user, token, loading, logout };
}
