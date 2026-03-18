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
    it('should create socket without auth', () => {
      const currentSessionIdRef = { current: 'session-123' };

      renderHook(() => useSocketConnection({ currentSessionIdRef }));

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          transports: ['polling', 'websocket'],
        })
      );

      // Verify auth is NOT in the options
      const callArgs = (io as jest.Mock).mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('auth');
    });

    it('should use SOCKET_URL from environment or default', () => {
      const currentSessionIdRef = { current: 'session-123' };

      renderHook(() => useSocketConnection({ currentSessionIdRef }));

      expect(io).toHaveBeenCalledWith(
        expect.stringMatching(/http:\/\/localhost:4000/),
        expect.any(Object)
      );
    });

    it('should return socket in state', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { result } = renderHook(() => useSocketConnection({ currentSessionIdRef }));

      expect(result.current.socket).toBe(mockSocket);
      expect(result.current.socketRef.current).toBe(mockSocket);
    });
  });

  describe('Connection handling', () => {
    it('should set connected to true on connect', async () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { result } = renderHook(() => useSocketConnection({ currentSessionIdRef }));

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

      renderHook(() => useSocketConnection({ currentSessionIdRef }));

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

      const { result } = renderHook(() => useSocketConnection({ currentSessionIdRef }));

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

      const { result } = renderHook(() => useSocketConnection({ currentSessionIdRef }));

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

      const { unmount } = renderHook(() => useSocketConnection({ currentSessionIdRef }));

      expect(mockSocket.close).not.toHaveBeenCalled();

      unmount();

      expect(mockSocket.close).toHaveBeenCalled();
    });

    it('should clear disconnect timer on unmount', () => {
      const currentSessionIdRef = { current: 'session-123' };

      const { unmount } = renderHook(() => useSocketConnection({ currentSessionIdRef }));

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

      const { result, unmount } = renderHook(() => useSocketConnection({ currentSessionIdRef }));

      expect(result.current.socketRef.current).toBe(mockSocket);

      unmount();

      expect(result.current.socketRef.current).toBeNull();
    });
  });

  describe('Session ID handling', () => {
    it('should emit join_session with current session on connect', async () => {
      const currentSessionIdRef = { current: 'session-abc' };

      renderHook(() => useSocketConnection({ currentSessionIdRef }));

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

      renderHook(() => useSocketConnection({ currentSessionIdRef }));

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
