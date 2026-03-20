import type { Server as SocketIOServer } from "socket.io";

// ---- Types ----

export interface FleetSessionInfo {
  sessionId: string;
  status: 'running' | 'idle' | 'completed' | 'failed';
  workspace: string;
  toolCount: number;
  activeAgents: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt: string;
  lastActivity: string;
  label: string;
  filesTouched: string[];
}

export interface FleetState {
  sessions: FleetSessionInfo[];
  aggregate: {
    totalSessions: number;
    activeSessions: number;
    totalToolCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}

// ---- State ----

const sessions = new Map<string, FleetSessionInfo>();
let ioInstance: SocketIOServer | null = null;
let lastEmitTime = 0;
const EMIT_THROTTLE_MS = 1000;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

// ---- Public API ----

export function registerSession(sessionId: string, workspace: string): void {
  const existing = sessions.get(sessionId);
  if (!existing) {
    const info: FleetSessionInfo = {
      sessionId,
      status: 'idle',
      workspace,
      toolCount: 0,
      activeAgents: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      label: '',
      filesTouched: [],
    };
    sessions.set(sessionId, info);
  }
}

export function updateSessionStatus(sessionId: string, status: FleetSessionInfo['status']): void {
  const session = sessions.get(sessionId);
  if (session) {
    const updated: FleetSessionInfo = {
      ...session,
      status,
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    const isTerminal = status === 'completed' || status === 'failed';
    emitFleetUpdate(isTerminal);
  }
}

export function incrementToolCount(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    const updated: FleetSessionInfo = {
      ...session,
      toolCount: session.toolCount + 1,
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    emitFleetUpdate();
  }
}

export function incrementAgentCount(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    const updated: FleetSessionInfo = {
      ...session,
      activeAgents: session.activeAgents + 1,
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    emitFleetUpdate();
  }
}

export function decrementAgentCount(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    const updated: FleetSessionInfo = {
      ...session,
      activeAgents: Math.max(0, session.activeAgents - 1),
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    emitFleetUpdate();
  }
}

export function updateTokens(sessionId: string, input: number, output: number): void {
  const session = sessions.get(sessionId);
  if (session) {
    const updated: FleetSessionInfo = {
      ...session,
      inputTokens: session.inputTokens + input,
      outputTokens: session.outputTokens + output,
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    emitFleetUpdate();
  }
}

export function addFileTouched(sessionId: string, filePath: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    const filesTouched = session.filesTouched.includes(filePath)
      ? session.filesTouched
      : [...session.filesTouched, filePath];

    const updated: FleetSessionInfo = {
      ...session,
      filesTouched,
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    emitFleetUpdate();
  }
}

export function setLabel(sessionId: string, label: string): void {
  const session = sessions.get(sessionId);
  if (session && !session.label) {
    const updated: FleetSessionInfo = {
      ...session,
      label,
    };
    sessions.set(sessionId, updated);
    emitFleetUpdate();
  }
}

export function getFleetState(): FleetState {
  const sessionList = Array.from(sessions.values());

  const aggregate = {
    totalSessions: sessionList.length,
    activeSessions: sessionList.filter(s => s.status === 'running').length,
    totalToolCalls: sessionList.reduce((sum, s) => sum + s.toolCount, 0),
    totalInputTokens: sessionList.reduce((sum, s) => sum + s.inputTokens, 0),
    totalOutputTokens: sessionList.reduce((sum, s) => sum + s.outputTokens, 0),
  };

  return {
    sessions: sessionList,
    aggregate,
  };
}

export function getSessionDetail(sessionId: string): FleetSessionInfo | null {
  return sessions.get(sessionId) ?? null;
}

export function setIOInstance(io: SocketIOServer): void {
  ioInstance = io;
}

function doEmit(): void {
  if (!ioInstance) return;
  lastEmitTime = Date.now();
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  const state = getFleetState();
  ioInstance.to('fleet_monitor').emit('fleet_update', state);
}

export function emitFleetUpdate(force = false): void {
  if (!ioInstance) return;

  if (force) {
    doEmit();
    return;
  }

  const now = Date.now();
  if (now - lastEmitTime < EMIT_THROTTLE_MS) {
    // Schedule trailing-edge emit so updates are never lost
    if (!pendingTimeout) {
      pendingTimeout = setTimeout(doEmit, EMIT_THROTTLE_MS - (now - lastEmitTime));
    }
    return;
  }

  doEmit();
}

// ---- Testing helpers ----

export function _clearSessions(): void {
  sessions.clear();
  lastEmitTime = 0;
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
}
