import { useState, useEffect, useRef, MutableRefObject } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface UseSocketConnectionProps {
  currentSessionIdRef: MutableRefObject<string>;
}

export function useSocketConnection({ currentSessionIdRef }: UseSocketConnectionProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => {
      // Clear any pending disconnect timer - we reconnected in time
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setConnected(true);
      connectedRef.current = true;
      // Join the current session room
      const currentSession = currentSessionIdRef.current;
      if (currentSession) {
        newSocket.emit('join_session', { session_id: currentSession });
      }
    });

    newSocket.on('disconnect', () => {
      // Debounce setting connected to false to prevent flicker during reconnects
      disconnectTimerRef.current = setTimeout(() => {
        setConnected(false);
        connectedRef.current = false;
        disconnectTimerRef.current = null;
      }, 1500);
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    return () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      socketRef.current = null;
      newSocket.close();
    };
  }, [currentSessionIdRef]);

  return {
    socket,
    socketRef,
    connected,
    connectedRef,
  };
}
