import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuth } from './useAuth';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('useAuth', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockLocalStorage.clear();
  });

  describe('Auto-login flow', () => {
    it('should auto-login when no token in localStorage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'auto-token-123',
          user: { id: 'local', username: 'Local User' },
        }),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/auto-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(mockLocalStorage.getItem('ccplus_token')).toBe('auto-token-123');
      expect(result.current.token).toBe('auto-token-123');
      expect(result.current.user).toEqual({ id: 'local', username: 'Local User' });
    });

    it('should handle auto-login failure gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useAuth());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
      expect(mockLocalStorage.getItem('ccplus_token')).toBeNull();
    });

    it('should handle auto-login non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
    });
  });

  describe('Token verification', () => {
    it('should verify existing token from localStorage', async () => {
      mockLocalStorage.setItem('ccplus_token', 'existing-token-456');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: { id: 'user-123', username: 'Verified User' },
        }),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'existing-token-456' }),
      });

      expect(result.current.token).toBe('existing-token-456');
      expect(result.current.user).toEqual({ id: 'user-123', username: 'Verified User' });
      expect(mockLocalStorage.getItem('ccplus_token')).toBe('existing-token-456');
    });

    it('should fall back to auto-login when token verification fails', async () => {
      mockLocalStorage.setItem('ccplus_token', 'invalid-token');

      // First call: verify token (fails)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      // Second call: auto-login (succeeds)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'new-auto-token-789',
          user: { id: 'local', username: 'Local User' },
        }),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/auth/verify', expect.any(Object));
      expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/auth/auto-login', expect.any(Object));

      expect(mockLocalStorage.getItem('ccplus_token')).toBe('new-auto-token-789');
      expect(result.current.token).toBe('new-auto-token-789');
      expect(result.current.user).toEqual({ id: 'local', username: 'Local User' });
    });

    it('should handle token verification network error', async () => {
      mockLocalStorage.setItem('ccplus_token', 'token-network-fail');

      // First call: verify token (network error)
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Second call: auto-login (succeeds)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'recovery-token',
          user: { id: 'local', username: 'Local User' },
        }),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockLocalStorage.getItem('ccplus_token')).toBe('recovery-token');
      expect(result.current.token).toBe('recovery-token');
    });
  });

  describe('Token storage', () => {
    it('should store token in localStorage on successful auto-login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'stored-token',
          user: { id: 'local', username: 'Local User' },
        }),
      });

      renderHook(() => useAuth());

      await waitFor(() => {
        expect(mockLocalStorage.getItem('ccplus_token')).toBe('stored-token');
      });
    });

    it('should remove invalid token from localStorage before auto-login', async () => {
      mockLocalStorage.setItem('ccplus_token', 'bad-token');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'new-token',
          user: { id: 'local', username: 'Local User' },
        }),
      });

      renderHook(() => useAuth());

      await waitFor(() => {
        expect(mockLocalStorage.getItem('ccplus_token')).toBe('new-token');
      });
    });
  });

  describe('Logout', () => {
    it('should clear token and user on logout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'logout-test-token',
          user: { id: 'local', username: 'Local User' },
        }),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).not.toBeNull();
      expect(result.current.token).not.toBeNull();
      expect(mockLocalStorage.getItem('ccplus_token')).toBe('logout-test-token');

      act(() => {
        result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
      expect(mockLocalStorage.getItem('ccplus_token')).toBeNull();
    });
  });

  describe('Loading states', () => {
    it('should start with loading true', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useAuth());

      expect(result.current.loading).toBe(true);
    });

    it('should set loading false after successful verification', async () => {
      mockLocalStorage.setItem('ccplus_token', 'verify-token');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: { id: 'user-123', username: 'Test User' },
        }),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should set loading false after successful auto-login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'auto-login-token',
          user: { id: 'local', username: 'Local User' },
        }),
      });

      const { result } = renderHook(() => useAuth());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should set loading false even when all auth methods fail', async () => {
      mockLocalStorage.setItem('ccplus_token', 'fail-token');

      mockFetch.mockRejectedValueOnce(new Error('Verify failed'));
      mockFetch.mockRejectedValueOnce(new Error('Auto-login failed'));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty response body on auto-login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // With empty response, the hook initializes with null state
      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
    });

    it('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
    });
  });
});
