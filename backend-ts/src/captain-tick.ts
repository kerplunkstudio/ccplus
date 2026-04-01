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

// ---- Actionable output patterns ----
// Tick responses matching these patterns are NOT suppressed — they contain
// meaningful output the user or fleet system should receive.
const ACTIONABLE_PATTERNS = [
  /start_session/i,
  /starting session/i,
  /session started/i,
  /launching/i,
  /\[fleet\]/i,
  /error:/i,
  /failed:/i,
  /warning:/i,
  /completed/i,
  /cancelled/i,
  /\bstuck\b/i,
  /\bblocker\b/i,
  /\bapprove\b/i,
  /\bpending\b/i,
  /\bcancel_session\b/i,
  /\bdecision\b/i,
];

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

/**
 * Activate brief mode for the current tick cycle.
 * Called immediately before sendCaptainMessage for tick-originated prompts.
 * Brief mode will suppress Captain responses that do not match actionable patterns.
 */
export function activateBriefMode(): void {
  tickState = {
    ...tickState,
    briefMode: true,
  };
  log.debug('Captain: brief mode activated for tick cycle');
}

/**
 * Deactivate brief mode.
 * Called after a tick query completes, and also by sendCaptainMessage
 * when any non-tick source sends a message (to guarantee user messages
 * always get through).
 */
export function resetBriefMode(): void {
  if (tickState.briefMode) {
    tickState = {
      ...tickState,
      briefMode: false,
    };
    log.debug('Captain: brief mode reset');
  }
}

/**
 * Return true if the response text should be suppressed during brief mode.
 *
 * Suppression rules:
 * - Brief mode must be active
 * - Text must not match any actionable pattern
 *
 * Called in captain.ts processQueryResponse before routing text to callbacks.
 */
export function shouldSuppressBriefOutput(text: string): boolean {
  if (!tickState.briefMode) return false;
  const isActionable = ACTIONABLE_PATTERNS.some(pattern => pattern.test(text));
  if (isActionable) {
    log.debug('Captain: brief mode — actionable output, NOT suppressed');
    return false;
  }
  log.debug('Captain: brief mode — non-actionable output suppressed');
  return true;
}

/**
 * Send a tick-originated message to Captain.
 * Sets brief mode ON before sending and schedules auto-reset after the
 * tick query completes (via the returned cleanup function).
 *
 * Usage:
 *   const cleanup = sendTickMessage(content, sendCaptainMessageFn);
 *   // ... when tick query completes:
 *   cleanup();
 *
 * @param content - The tick prompt content
 * @param sendMessage - The sendCaptainMessage function from captain.ts
 * @returns A cleanup function that MUST be called after the tick query completes
 */
export function sendTickMessage(
  content: string,
  sendMessage: (content: string, source: 'fleet', sourceId: string) => void,
): () => void {
  activateBriefMode();

  try {
    sendMessage(content, 'fleet', 'tick');
  } catch (error) {
    // Reset immediately on send failure — don't leave brief mode stuck on
    resetBriefMode();
    throw error;
  }

  // Return cleanup that resets brief mode after query completes
  return function cleanupBriefMode() {
    resetBriefMode();
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
