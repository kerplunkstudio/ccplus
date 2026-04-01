import type { EnrichedFleetSessionInfo } from './fleet-monitor.js';
import { log } from './logger.js';

// ---- Types ----

export interface FleetTickSummary {
  activeSessions: number;
  pendingSessions: number;
  recentlyCompleted: number;
  stuckSessions: number;
}

export interface TickLoopDependencies {
  isCaptainAlive: () => boolean;
  isCaptainIdle: () => boolean;
  sendTickMessage: (message: string) => void;
  getFleetState: () => {
    totalSessions: number;
    activeSessions: number;
    pendingSessions: number;
    recentlyCompleted: number;
    stuckSessions: number;
    sessions: EnrichedFleetSessionInfo[];
  };
  isTerminalFocused: () => boolean;
  getTickIntervalMs: () => number;
  isTickEnabled: () => boolean;
}

export interface TickMessageContext {
  timestamp: string;
  uptimeMs: number;
  terminalFocused: boolean;
  fleetSummary: FleetTickSummary;
  tickNumber: number;
}

export interface TickState {
  tickNumber: number;
  lastTickAt: string | null;
  sleepRemaining: number;
  briefMode: boolean;
}

export interface SleepInfo {
  sleepUntilTick: number;
}

// ---- State ----

let tickState: TickState = {
  tickNumber: 0,
  lastTickAt: null,
  sleepRemaining: 0,
  briefMode: false,
};

let tickInterval: ReturnType<typeof setInterval> | null = null;
let tickStartTime: number | null = null;
let deps: TickLoopDependencies | null = null;

// ---- Public API ----

export function startTickLoop(dependencies: TickLoopDependencies): void {
  if (tickInterval) {
    stopTickLoop();
  }

  deps = dependencies;
  tickStartTime = Date.now();

  const intervalMs = dependencies.getTickIntervalMs();

  tickInterval = setInterval(() => {
    tick();
  }, intervalMs);
}

export function stopTickLoop(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  deps = null;
}

export function sleepTicks(count: number): SleepInfo {
  tickState = {
    ...tickState,
    sleepRemaining: count,
  };

  return {
    sleepUntilTick: tickState.tickNumber + count,
  };
}

export function getSleepRemaining(): number {
  return tickState.sleepRemaining;
}

export function isBriefMode(): boolean {
  return tickState.briefMode;
}

export function resetBriefMode(): void {
  tickState = {
    ...tickState,
    briefMode: false,
  };
}

export function getTickState(): TickState {
  return { ...tickState };
}

export function buildTickMessage(context: TickMessageContext): string {
  const { timestamp, uptimeMs, terminalFocused, fleetSummary, tickNumber } = context;

  return `<tick number="${tickNumber}" timestamp="${timestamp}" uptime_ms="${uptimeMs}" terminal_focused="${terminalFocused}" active="${fleetSummary.activeSessions}" pending="${fleetSummary.pendingSessions}" recently_completed="${fleetSummary.recentlyCompleted}" stuck="${fleetSummary.stuckSessions}"></tick>`;
}

export function _resetTickState(): void {
  tickState = {
    tickNumber: 0,
    lastTickAt: null,
    sleepRemaining: 0,
    briefMode: false,
  };
  tickStartTime = null;
}

// ---- Internal Tick Logic ----

function tick(): void {
  if (!deps) return;

  const enabled = deps.isTickEnabled();
  const alive = deps.isCaptainAlive();
  const idle = deps.isCaptainIdle();

  // Guard: tick enabled
  if (!deps.isTickEnabled()) return;

  // Guard: Captain alive
  if (!deps.isCaptainAlive()) return;

  // Guard: Captain idle
  if (!deps.isCaptainIdle()) return;

  // Guard: not sleeping
  if (tickState.sleepRemaining > 0) {
    tickState = {
      ...tickState,
      sleepRemaining: tickState.sleepRemaining - 1,
    };
    return;
  }

  try {
    // Fire tick
    const now = new Date().toISOString();
    const uptimeMs = tickStartTime ? Date.now() - tickStartTime : 0;
    const terminalFocused = deps.isTerminalFocused();
    const fleetState = deps.getFleetState();

    // Compute fleet summary
    const fleetSummary = computeFleetSummary(fleetState.sessions);

    // Update tick state
    tickState = {
      ...tickState,
      tickNumber: tickState.tickNumber + 1,
      lastTickAt: now,
      briefMode: true,
    };

    // Build and send tick message
    const message = buildTickMessage({
      timestamp: now,
      uptimeMs,
      terminalFocused,
      fleetSummary,
      tickNumber: tickState.tickNumber,
    });

    log.info('Tick fired', { tickNumber: tickState.tickNumber, fleetSummary });
    deps.sendTickMessage(message);
  } catch (error) {
    log.error('Tick failed', { error: String(error), stack: (error as Error).stack });
  }
}

function computeFleetSummary(sessions: EnrichedFleetSessionInfo[]): FleetTickSummary {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  let recentlyCompleted = 0;
  let stuckSessions = 0;

  for (const session of sessions) {
    // Count recently completed sessions (completed in last 5 minutes)
    if (
      (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') &&
      new Date(session.lastActivity).getTime() > fiveMinutesAgo
    ) {
      recentlyCompleted++;
    }

    // Count stuck sessions
    if (session.stuckDetectedAt) {
      stuckSessions++;
    }
  }

  const activeSessions = sessions.filter(s => s.status === 'running').length;
  const pendingSessions = sessions.filter(s => s.status === 'pending').length;

  return {
    activeSessions,
    pendingSessions,
    recentlyCompleted,
    stuckSessions,
  };
}
