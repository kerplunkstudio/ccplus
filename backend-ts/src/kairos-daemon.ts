/**
 * kairos-daemon.ts
 *
 * KAIROS check -- called from the captain tick loop.
 * When enough unreviewed sessions accumulate (>= min batch),
 * sends a message to Captain to start a kairos workflow session.
 */

import * as config from "./config.js";
import { getUnanalyzedSessionIds, markSessionsAnalyzed } from "./db/kairos.js";

// ---- Types ----

export interface KairosDeps {
  readonly sendCaptainMessage: (content: string, source: string, sourceId: string) => void;
  readonly isCaptainAlive: () => boolean;
  readonly getActiveSessionCount: () => number;
  readonly log: {
    info: (msg: string, context?: Record<string, unknown>) => void;
    error: (msg: string, context?: Record<string, unknown>) => void;
    warn: (msg: string, context?: Record<string, unknown>) => void;
  };
}

export interface KairosState {
  readonly enabled: boolean;
  readonly analyzing: boolean;
  readonly checkCount: number;
  readonly lastCheckAt: string | null;
  readonly lastAnalysisAt: string | null;
  readonly totalBatchesTriggered: number;
}

// ---- Module State ----

let state: KairosState = {
  enabled: config.KAIROS_ENABLED,
  analyzing: false,
  checkCount: 0,
  lastCheckAt: null,
  lastAnalysisAt: null,
  totalBatchesTriggered: 0,
};

// Track which sessions are in the current batch
let currentBatchSessionIds: string[] = [];

// Track when Captain first became idle (for 10-minute threshold)
let idleSince: number | null = null;

// ---- Constants ----

const KAIROS_MIN_BATCH_SIZE = config.KAIROS_MIN_SESSIONS_FOR_RUN;
const KAIROS_MAX_BATCH_SIZE = config.KAIROS_BATCH_SIZE;

// ---- Core Logic ----

/**
 * Called from the captain tick loop on every tick.
 * Checks if KAIROS should run and tells Captain to start a kairos session.
 */
export function checkKairos(deps: KairosDeps): void {
  state = {
    ...state,
    checkCount: state.checkCount + 1,
    lastCheckAt: new Date().toISOString(),
  };

  // Guard: KAIROS disabled
  if (!state.enabled) return;

  // Guard: Captain not alive
  if (!deps.isCaptainAlive()) return;

  // Guard: Other sessions are still running (reset idle timer)
  const activeCount = deps.getActiveSessionCount();
  if (activeCount > 0) {
    deps.log.info("KAIROS: skipping — fleet has active sessions", { activeCount });
    idleSince = null;
    return;
  }

  // Track idle duration (starts when fleet has zero active sessions)
  if (idleSince === null) {
    idleSince = Date.now();
  }
  const idleMs = Date.now() - idleSince;

  // Guard: Not idle long enough (30 minutes)
  if (idleMs < 30 * 60 * 1000) return;

  // Guard: Cooldown — at most once every 3 hours
  if (state.lastAnalysisAt) {
    const msSinceLastAnalysis = Date.now() - new Date(state.lastAnalysisAt).getTime();
    if (msSinceLastAnalysis < 3 * 60 * 60 * 1000) return;
  }

  // Guard: Already triggered an analysis that hasn't completed
  if (state.analyzing) return;

  try {
    const sessionIds = getUnanalyzedSessionIds(KAIROS_MAX_BATCH_SIZE);

    // Guard: Not enough sessions
    if (sessionIds.length < KAIROS_MIN_BATCH_SIZE) return;

    deps.log.info("KAIROS: triggering analysis via Captain", {
      sessionCount: sessionIds.length,
    });

    // Build message for Captain
    const sessionList = sessionIds.map((id) => `  - ${id}`).join("\n");
    const message = [
      `[FLEET][AUTO] KAIROS retrospective — starting automatically. ${sessionIds.length} sessions ready for analysis.`,
      ``,
      `Start a session NOW with workflow: "kairos" to analyze these sessions:`,
      sessionList,
      ``,
      `Session ID suggestion: kairos-analysis-${Date.now()}`,
      `Use the workspace: ${config.PROJECT_ROOT}`,
      `Include the full session ID list in the prompt so the KAIROS agent knows which sessions to review.`,
      `Do NOT ask the user for confirmation — this is a pre-approved automated action.`,
    ].join("\n");

    // Mark sessions as analyzed immediately so they are excluded on restart
    markSessionsAnalyzed(sessionIds);

    deps.sendCaptainMessage(message, 'fleet', 'kairos');

    state = {
      ...state,
      analyzing: true,
      lastAnalysisAt: new Date().toISOString(),
      totalBatchesTriggered: state.totalBatchesTriggered + 1,
    };
  } catch (error) {
    deps.log.error("KAIROS: check failed", { error: String(error) });
  }
}

/**
 * Called when a kairos workflow session completes (or fails).
 * Resets the analyzing flag. Sessions are already marked at trigger time.
 */
export function onKairosSessionComplete(): void {
  state = { ...state, analyzing: false };
  idleSince = null; // Reset idle timer to prevent immediate re-trigger
}

// ---- Public API ----

export function getKairosState(): KairosState {
  return { ...state };
}

// Aliases for backward compat with server.ts wiring
export function startKairosDaemon(deps: { log: KairosDeps['log'] }): void {
  state = { ...state, enabled: true };
  deps.log.info("KAIROS enabled", {
    minBatchSize: KAIROS_MIN_BATCH_SIZE,
    maxBatchSize: KAIROS_MAX_BATCH_SIZE,
  });
}

export function stopKairosDaemon(): void {
  state = { ...state, enabled: false };
  idleSince = null;
}

export function getKairosDaemonState(): KairosState {
  return getKairosState();
}

/**
 * Reset state (for testing only).
 * @internal
 */
export function __resetStateForTesting(): void {
  state = {
    enabled: false,
    analyzing: false,
    checkCount: 0,
    lastCheckAt: null,
    lastAnalysisAt: null,
    totalBatchesTriggered: 0,
  };
  idleSince = null;
  currentBatchSessionIds = [];
}
