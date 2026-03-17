import { renderHook, waitFor, act } from '@testing-library/react';
import { useSocketConnection } from './useSocketConnection';
import { io } from 'socket.io-client';

jest.mock('socket.io-client');

describe('useSocketConnection', () => {
  let mockSocket: {
    on: jest.Mock;
    emit: jest.Mock;
    close: jest.Mock;
    io: { on: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      io: { on: jest.fn() },
    };
    (io as jest.Mock).mockReturnValue(mockSocket);
  });

  describe('Socket creation', () => {
    it('should create socket with auth token', () => {
      const currentSessionIdRef = { current: 'session-123' };

      renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: { token: 'test-token' },
          transports: ['polling', 'websocket'],
        })
      );
    });

    it('should not create socket if token is null', () => {
      const currentSessionIdRef = { current: 'session-123' };

      renderHook(() => useSocketConnection({ token: null, currentSessionIdRef }));

      expect(io).not.toHaveBeenCalled();
    });

    it('should use SOCKET_URL from environment or default', () => {
      const currentSessionIdRef = { current: 'session-123' };

      renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      expect(io).toHaveBeenCalledWith(
        expect.stringMatching(/http:\/\/localhost:4000/),
        expect.any(Object)
      );
    });

    it('should return socket in state', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { result } = renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      expect(result.current.socket).toBe(mockSocket);
      expect(result.current.socketRef.current).toBe(mockSocket);
    });
  });

  describe('Connection handling', () => {
    it('should set connected to true on connect', async () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { result } = renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      expect(result.current.connected).toBe(false);

      // Find and trigger connect handler
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];

      act(() => {
        connectHandler?.();
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
        expect(result.current.connectedRef.current).toBe(true);
      });
    });

    it('should emit join_session on connect', async () => {
      const currentSessionIdRef = { current: 'session-123' };

      renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      // Find and trigger connect handler
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];

      act(() => {
        connectHandler?.();
      });

      await waitFor(() => {
        expect(mockSocket.emit).toHaveBeenCalledWith('join_session', { session_id: 'session-123' });
      });
    });

    it('should set connected to false on disconnect after debounce', async () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { result } = renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      // Trigger connect first
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
      act(() => {
        connectHandler?.();
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Now trigger disconnect
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')?.[1];

      act(() => {
        disconnectHandler?.();
      });

      // Should still be connected immediately (debounced)
      expect(result.current.connected).toBe(true);

      // Wait for debounce (1500ms)
      await waitFor(() => {
        expect(result.current.connected).toBe(false);
        expect(result.current.connectedRef.current).toBe(false);
      }, { timeout: 2000 });
    });

    it('should clear disconnect timer on reconnect', async () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { result } = renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      // Trigger connect
      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];
      act(() => {
        connectHandler?.();
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Trigger disconnect
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')?.[1];
      act(() => {
        disconnectHandler?.();
      });

      // Immediately reconnect before debounce expires
      act(() => {
        connectHandler?.();
      });

      // Should remain connected (timer was cleared)
      expect(result.current.connected).toBe(true);

      // Wait past debounce time to ensure it doesn't set to false
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(result.current.connected).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should close socket on unmount', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { unmount } = renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      expect(mockSocket.close).not.toHaveBeenCalled();

      unmount();

      expect(mockSocket.close).toHaveBeenCalled();
    });

    it('should clear disconnect timer on unmount', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { unmount } = renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      // Trigger disconnect to start timer
      const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')?.[1];
      act(() => {
        disconnectHandler?.();
      });

      // Unmount should clear the timer
      unmount();

      expect(mockSocket.close).toHaveBeenCalled();
    });

    it('should clear socketRef on unmount', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { result, unmount } = renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      expect(result.current.socketRef.current).toBe(mockSocket);

      unmount();

      expect(result.current.socketRef.current).toBeNull();
    });
  });

  describe('Token change handling', () => {
    it('should create new socket when token changes', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { rerender } = renderHook(
        ({ token }) => useSocketConnection({ token, currentSessionIdRef }),
        { initialProps: { token: 'token-1' } }
      );

      expect(io).toHaveBeenCalledTimes(1);
      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ auth: { token: 'token-1' } })
      );

      // Clear mock to count new calls
      (io as jest.Mock).mockClear();

      rerender({ token: 'token-2' });

      expect(io).toHaveBeenCalledTimes(1);
      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ auth: { token: 'token-2' } })
      );
    });

    it('should close old socket when token changes', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { rerender } = renderHook(
        ({ token }) => useSocketConnection({ token, currentSessionIdRef }),
        { initialProps: { token: 'token-1' } }
      );

      const firstSocket = mockSocket;

      // Create new mock for second token
      const secondSocket = {
        on: jest.fn(),
        emit: jest.fn(),
        close: jest.fn(),
        io: { on: jest.fn() },
      };
      (io as jest.Mock).mockReturnValue(secondSocket);

      rerender({ token: 'token-2' });

      expect(firstSocket.close).toHaveBeenCalled();
    });
  });

  describe('Session ID handling', () => {
    it('should emit join_session with current session on connect', async () => {
      const currentSessionIdRef = { current: 'session-abc' };

      renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];

      act(() => {
        connectHandler?.();
      });

      await waitFor(() => {
        expect(mockSocket.emit).toHaveBeenCalledWith('join_session', { session_id: 'session-abc' });
      });
    });

    it('should not emit join_session if currentSessionId is empty', async () => {
      const currentSessionIdRef = { current: '' };

      renderHook(() => useSocketConnection({ token: 'test-token', currentSessionIdRef }));

      const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1];

      act(() => {
        connectHandler?.();
      });

      // Give it time to potentially emit
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockSocket.emit).not.toHaveBeenCalledWith('join_session', expect.anything());
    });
  });
});
