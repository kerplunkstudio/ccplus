import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { SessionMetadata } from '../types';

interface UseSessionMetadataResult {
  metadata: SessionMetadata;
  updateMetadata: (patch: Partial<SessionMetadata>) => void;
  isLoading: boolean;
}

export function useSessionMetadata(socket: Socket | null): UseSessionMetadataResult {
  const [metadata, setMetadata] = useState<SessionMetadata>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!socket) {
      setIsLoading(true);
      return;
    }

    // Listen for initial session metadata
    const handleSessionMetadata = (data: SessionMetadata) => {
      setMetadata(data);
      setIsLoading(false);
    };

    // Listen for metadata updates
    const handleSessionUpdated = (data: SessionMetadata) => {
      setMetadata(data);
    };

    socket.on('session:metadata', handleSessionMetadata);
    socket.on('session:updated', handleSessionUpdated);

    return () => {
      socket.off('session:metadata', handleSessionMetadata);
      socket.off('session:updated', handleSessionUpdated);
    };
  }, [socket]);

  const updateMetadata = useCallback(
    (patch: Partial<SessionMetadata>) => {
      if (!socket) return;

      // Optimistically update local state
      setMetadata((prev) => ({ ...prev, ...patch }));

      // Emit patch to server
      socket.emit('session:patch', patch);
    },
    [socket]
  );

  return { metadata, updateMetadata, isLoading };
}
