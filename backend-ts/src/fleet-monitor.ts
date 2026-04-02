import type { Server as SocketIOServer } from "socket.io";
import { upsertFleetSession, getAllFleetSessions, getNextSessionNumber } from "./db/fleet-sessions.js";
import { getWorkflowState } from "./workflow-state.js";
import { log } from "./logger.js";
import { onKairosSessionComplete } from "./kairos-daemon.js";

// ---- Types ----

export interface FleetSessionInfo {
  sessionId: string;
  status: 'running' | 'idle' | 'completed' | 'failed' | 'cancelled' | 'pending';
  workspace: string;
  toolCount: number;
  activeAgents: number;
  totalAgents: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt: string;
  lastActivity: string;
  label: string;
  filesTouched: string[];
  requestedBy?: { source: string; sourceId: string };
  stuckDetectedAt?: number;
  description?: string;
  sessionNumber?: number;
}

export interface EnrichedFleetSessionInfo extends FleetSessionInfo {
  workflowPhase?: string;
  workflowName?: string;
}

export interface FleetState {
  sessions: EnrichedFleetSessionInfo[];
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

// ---- Stuck Session Detection ----

const STUCK_TOOL_THRESHOLD = 30;
const STUCK_IDLE_THRESHOLD_MS = 120_000;
const STUCK_CHECK_INTERVAL_MS = 30_000;

type StuckSessionCallback = (sessionId: string, info: FleetSessionInfo) => void;
let stuckSessionCallback: StuckSessionCallback | null = null;
let stuckDetectorTimer: ReturnType<typeof setInterval> | null = null;

// ---- Session Pruner ----

const PRUNE_MAX_AGE_MS = 60 * 60 * 1000;  // 1 hour for running/idle sessions
const PRUNE_TERMINAL_AGE_MS = 15 * 60 * 1000;  // 15 minutes for terminal sessions
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;  // 10 minutes
const TERMINAL_STATUSES = new Set<FleetSessionInfo['status']>(['completed', 'failed', 'cancelled']);

// ---- Public API ----

export function loadSessionsFromDb(): void {
  const dbSessions = getAllFleetSessions();
  for (const session of dbSessions) {
    sessions.set(session.sessionId, session);
  }
}

export function registerSession(sessionId: string, workspace: string, requestedBy?: { source: string; sourceId: string }, description?: string): void {
  const existing = sessions.get(sessionId);
  if (!existing) {
    const info: FleetSessionInfo = {
      sessionId,
      status: 'idle',
      workspace,
      toolCount: 0,
      activeAgents: 0,
      totalAgents: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      label: '',
      filesTouched: [],
      requestedBy,
      description,
      sessionNumber: getNextSessionNumber(),
    };
    sessions.set(sessionId, info);
    upsertFleetSession(info);
  }
}

export function updateSessionStatus(sessionId: string, status: FleetSessionInfo['status']): void {
  const session = sessions.get(sessionId);
  if (session) {
    const now = new Date().toISOString();
    let durationMs = session.durationMs;

    // Calculate duration when session reaches terminal state
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      const startTime = new Date(session.startedAt).getTime();
      durationMs = Date.now() - startTime;
    }

    const updated: FleetSessionInfo = {
      ...session,
      status,
      durationMs,
      lastActivity: now,
    };
    sessions.set(sessionId, updated);
    upsertFleetSession(updated);
    const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';
    emitFleetUpdate(isTerminal);

    // Reset KAIROS analyzing flag when a kairos session finishes
    if (isTerminal && sessionId.startsWith('kairos-')) {
      onKairosSessionComplete();
    }
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
    upsertFleetSession(updated);
    emitFleetUpdate();
  }
}

export function incrementAgentCount(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    const updated: FleetSessionInfo = {
      ...session,
      activeAgents: session.activeAgents + 1,
      totalAgents: session.totalAgents + 1,
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    upsertFleetSession(updated);
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
    upsertFleetSession(updated);
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
    upsertFleetSession(updated);
    emitFleetUpdate();
  }
}

export function updateSessionTokens(sessionId: string, inputTokens: number, outputTokens: number): void {
  const session = sessions.get(sessionId);
  if (session) {
    const updated: FleetSessionInfo = {
      ...session,
      inputTokens,
      outputTokens,
      lastActivity: new Date().toISOString(),
    };
    sessions.set(sessionId, updated);
    upsertFleetSession(updated);
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
    upsertFleetSession(updated);
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
    upsertFleetSession(updated);
    emitFleetUpdate();
  }
}

export function getFleetState(): FleetState {
  const sessionList = Array.from(sessions.values());

  const enrichedSessions: EnrichedFleetSessionInfo[] = sessionList.map(session => {
    if (session.status === 'running') {
      const workflowState = getWorkflowState(session.sessionId);
      return {
        ...session,
        workflowPhase: workflowState.phase,
        workflowName: workflowState.workflowName,
      };
    }
    return session;
  });

  const aggregate = {
    totalSessions: sessionList.length,
    activeSessions: sessionList.filter(s => s.status === 'running').length,
    pendingSessions: sessionList.filter(s => s.status === 'pending').length,
    totalToolCalls: sessionList.reduce((sum, s) => sum + s.toolCount, 0),
    totalInputTokens: sessionList.reduce((sum, s) => sum + s.inputTokens, 0),
    totalOutputTokens: sessionList.reduce((sum, s) => sum + s.outputTokens, 0),
  };

  return {
    sessions: enrichedSessions,
    aggregate,
  };
}

export function getSessionDetail(sessionId: string): FleetSessionInfo | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * Check if a set of files overlaps with files being touched by running sessions.
 * Returns a list of { sessionId, overlappingFiles } for any active sessions that touch the same files.
 */
export function getFileOverlaps(files: string[], excludeSessionId?: string): Array<{ sessionId: string; overlappingFiles: string[] }> {
  const overlaps: Array<{ sessionId: string; overlappingFiles: string[] }> = [];

  for (const [sessionId, info] of sessions.entries()) {
    if (excludeSessionId && sessionId === excludeSessionId) continue;
    if (info.status !== 'running' && info.status !== 'idle') continue;

    // Normalize paths — strip worktree prefix to get relative paths
    const normalizeFile = (f: string): string => {
      const worktreeMatch = f.match(/\.claude\/worktrees\/[^/]+\/(.+)/);
      return worktreeMatch ? worktreeMatch[1] : f;
    };

    const sessionFiles = info.filesTouched.map(normalizeFile);
    const checkFiles = files.map(normalizeFile);

    const common = checkFiles.filter(f => sessionFiles.includes(f));
    if (common.length > 0) {
      overlaps.push({ sessionId, overlappingFiles: common });
    }
  }

  return overlaps;
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

// ---- Stuck Session Detection Functions ----

export function onSessionStuck(callback: StuckSessionCallback): void {
  stuckSessionCallback = callback;
}

function detectStuckSessions(): void {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (
      session.status === 'running' &&
      !session.stuckDetectedAt &&
      session.toolCount >= STUCK_TOOL_THRESHOLD &&
      session.filesTouched.length === 0 &&
      now - new Date(session.lastActivity).getTime() > STUCK_IDLE_THRESHOLD_MS
    ) {
      const updated: FleetSessionInfo = {
        ...session,
        stuckDetectedAt: now,
      };
      sessions.set(session.sessionId, updated);
      upsertFleetSession(updated);

      if (ioInstance) {
        ioInstance.to('fleet_monitor').emit('session_stuck', {
          sessionId: session.sessionId,
          toolCount: session.toolCount,
          filesTouched: session.filesTouched.length,
          durationMs: now - new Date(session.startedAt).getTime(),
        });
      }

      if (stuckSessionCallback) {
        try {
          stuckSessionCallback(session.sessionId, updated);
        } catch {
          // swallow callback errors
        }
      }
    }
  }
}

export function startStuckDetector(): void {
  if (stuckDetectorTimer) return;
  stuckDetectorTimer = setInterval(detectStuckSessions, STUCK_CHECK_INTERVAL_MS);
}

export function stopStuckDetector(): void {
  if (stuckDetectorTimer) {
    clearInterval(stuckDetectorTimer);
    stuckDetectorTimer = null;
  }
}

// ---- Zombie Reaper ----

const ZOMBIE_REAPER_INTERVAL_MS = 60_000; // every minute
const ZOMBIE_TIMEOUT_MS = 5 * 60_000; // 5 minutes

let zombieReaperTimer: ReturnType<typeof setInterval> | null = null;
let prunerTimer: ReturnType<typeof setInterval> | null = null;

export function startZombieReaper(): void {
  if (zombieReaperTimer) return; // already running
  zombieReaperTimer = setInterval(reapZombieSessions, ZOMBIE_REAPER_INTERVAL_MS);
}

export function stopZombieReaper(): void {
  if (zombieReaperTimer) {
    clearInterval(zombieReaperTimer);
    zombieReaperTimer = null;
  }
}

function reapZombieSessions(): void {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (
      session.status === 'running' &&
      session.toolCount === 0 &&
      now - new Date(session.lastActivity).getTime() > ZOMBIE_TIMEOUT_MS
    ) {
      const startTime = new Date(session.startedAt).getTime();
      const updated: FleetSessionInfo = {
        ...session,
        status: 'failed',
        durationMs: now - startTime,
        lastActivity: new Date().toISOString(),
      };
      sessions.set(session.sessionId, updated);
      upsertFleetSession(updated);
      emitFleetUpdate(true);
    }
  }
}

// ---- Session Pruner ----

export function startPruner(): void {
  if (prunerTimer) return; // already running
  prunerTimer = setInterval(pruneOldSessions, PRUNE_INTERVAL_MS);
}

export function stopPruner(): void {
  if (prunerTimer) {
    clearInterval(prunerTimer);
    prunerTimer = null;
  }
}

function pruneOldSessions(): void {
  const now = Date.now();
  let pruneCount = 0;
  for (const [sessionId, session] of sessions.entries()) {
    const age = now - new Date(session.lastActivity).getTime();
    const isTerminal = TERMINAL_STATUSES.has(session.status);

    // Only prune terminal sessions (completed, failed, cancelled) after 15 minutes
    // Running/idle sessions are kept indefinitely
    if (isTerminal && age > PRUNE_TERMINAL_AGE_MS) {
      sessions.delete(sessionId);
      pruneCount++;
    }
  }
  if (pruneCount > 0) {
    log.info('Pruned old terminal sessions from memory', { pruneCount });
  }
}

// ---- Testing helpers ----

export function _clearSessions(): void {
  sessions.clear();
  lastEmitTime = 0;
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  stopZombieReaper();
  stopStuckDetector();
  stuckSessionCallback = null;
  stopPruner();
}

export function _setSessionLastActivity(sessionId: string, lastActivity: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    sessions.set(sessionId, { ...session, lastActivity });
  }
}

export function _detectStuckSessions(): void {
  detectStuckSessions();
}

export function _setSessionStartedAt(sessionId: string, startedAt: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    sessions.set(sessionId, { ...session, startedAt });
  }
}
