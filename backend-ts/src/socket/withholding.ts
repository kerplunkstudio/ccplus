/**
 * Withholding pattern for SDK error recovery.
 *
 * During recoverable errors (rate limits, overloaded), text_delta and tool_event
 * emissions are buffered instead of sent to the frontend. If the SDK recovers
 * successfully, the buffer is discarded (frontend never sees the broken partial).
 * If recovery fails, the buffer is flushed so the frontend sees what happened.
 *
 * Always pass through: rate_limit, error, and all control events.
 * Buffer only: text_delta, tool_event.
 */

import type { Server as SocketIOServer } from "socket.io";

export const WITHHOLDING_TIMEOUT_MS = 30_000;

export interface WithheldEvent {
  readonly event: string;
  readonly payload: Record<string, unknown>;
}

export interface WithholdingState {
  readonly active: boolean;
  readonly buffer: readonly WithheldEvent[];
  readonly timer: ReturnType<typeof setTimeout> | null;
}

const withholdingStates = new Map<string, WithholdingState>();

export function getWithholdingState(sessionId: string): WithholdingState {
  return withholdingStates.get(sessionId) ?? { active: false, buffer: [], timer: null };
}

export function startWithholding(
  sessionId: string,
  onTimeout: () => void,
): void {
  const existing = withholdingStates.get(sessionId);

  // Already withholding — just extend by doing nothing (timer keeps running)
  if (existing?.active) return;

  const timer = setTimeout(() => {
    onTimeout();
  }, WITHHOLDING_TIMEOUT_MS);

  withholdingStates.set(sessionId, { active: true, buffer: [], timer });
}

export function bufferEvent(sessionId: string, event: string, payload: Record<string, unknown>): void {
  const state = withholdingStates.get(sessionId);
  if (!state?.active) return;

  withholdingStates.set(sessionId, {
    ...state,
    buffer: [...state.buffer, { event, payload }],
  });
}

/**
 * Flush the withheld buffer to the frontend and stop withholding.
 * Called when recovery fails (error while withholding, or safety timeout).
 */
export function flushWithheld(
  sessionId: string,
  io: SocketIOServer,
): void {
  const state = withholdingStates.get(sessionId);
  if (!state) return;

  if (state.timer) clearTimeout(state.timer);

  for (const { event, payload } of state.buffer) {
    io.to(sessionId).emit(event, payload);
  }

  withholdingStates.delete(sessionId);
}

/**
 * Discard the withheld buffer without emitting — recovery succeeded.
 */
export function discardWithheld(sessionId: string): void {
  const state = withholdingStates.get(sessionId);
  if (!state) return;

  if (state.timer) clearTimeout(state.timer);
  withholdingStates.delete(sessionId);
}

/**
 * Remove withholding state entirely (session cleanup).
 */
export function clearWithholdingState(sessionId: string): void {
  const state = withholdingStates.get(sessionId);
  if (state?.timer) clearTimeout(state.timer);
  withholdingStates.delete(sessionId);
}
