import { useReducer, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { FleetState, FleetSession } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface FleetStateAction {
  type: 'SET_FLEET_STATE';
  payload: FleetState;
}

const fleetReducer = (state: FleetState, action: FleetStateAction): FleetState => {
  switch (action.type) {
    case 'SET_FLEET_STATE':
      return action.payload;
    default:
      return state;
  }
};

const initialState: FleetState = {
  sessions: [],
  aggregate: {
    totalSessions: 0,
    activeSessions: 0,
    totalToolCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  },
};

export function useFleetState(socket: Socket | null) {
  const [fleetState, dispatch] = useReducer(fleetReducer, initialState);

  // Fetch initial fleet state
  useEffect(() => {
    const fetchFleetState = async () => {
      try {
        const response = await fetch(`${SOCKET_URL}/api/fleet/state`);
        if (response.ok) {
          const data = await response.json();
          dispatch({ type: 'SET_FLEET_STATE', payload: data });
        }
      } catch (error) {
        // Silently fail, will retry on socket update
      }
    };

    fetchFleetState();
  }, []);

  // Listen for fleet updates via Socket.IO
  useEffect(() => {
    if (!socket) return;

    // Join fleet monitor room
    socket.emit('join_room', { room: 'fleet_monitor' });

    const handleFleetUpdate = (data: FleetState) => {
      dispatch({ type: 'SET_FLEET_STATE', payload: data });
    };

    socket.on('fleet_update', handleFleetUpdate);

    return () => {
      socket.off('fleet_update', handleFleetUpdate);
      socket.emit('leave_room', { room: 'fleet_monitor' });
    };
  }, [socket]);

  const getSessionById = useCallback(
    (sessionId: string): FleetSession | null => {
      return fleetState.sessions.find((s) => s.sessionId === sessionId) || null;
    },
    [fleetState.sessions]
  );

  return {
    fleetState,
    getSessionById,
  };
}
