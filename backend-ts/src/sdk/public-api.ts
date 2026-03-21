import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionCallbacks } from "./types.js";
import { sessions, getOrCreateSession } from "./session-manager.js";
import { streamQuery } from "./stream-query.js";
import { log } from "../logger.js";
import { eventLog } from '../event-log.js';
import * as fleetMonitor from '../fleet-monitor.js';

// ---- Public API ----

export function submitQuery(
  sessionId: string,
  prompt: string,
  workspace: string,
  callbacks: SessionCallbacks,
  model?: string,
  imageIds?: string[],
  requestedBy?: { source: string; sourceId: string },
): void {
  const session = getOrCreateSession(sessionId, workspace, model);

  // Register session and mark as running
  fleetMonitor.registerSession(sessionId, workspace, requestedBy);
  fleetMonitor.updateSessionStatus(sessionId, 'running');

  // Force-close stale query if one is lingering
  if (session.activeQuery !== null) {
    log.warn("Forcing cleanup of stale query", { sessionId });
    try {
      session.activeQuery.interrupt().catch(() => {});
      session.activeQuery.close();
    } catch {
      // already closed or invalid
    }
    session.activeQuery = null;
    session.streamingContent = '';
    session.cancelRequested = false;
  }

  session.callbacks = callbacks;
  session.cancelRequested = false;

  // Run query in background (don't await)
  streamQuery(session, prompt, workspace, model, imageIds).catch((err) => {
    log.error("Stream query error", { sessionId, error: String(err) });
    callbacks.onError(String(err));
  });
}

export function registerCallbacks(sessionId: string, callbacks: SessionCallbacks): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.callbacks = callbacks;
  }
}

export function cancelQuery(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.cancelRequested = true;
    if (session.activeQuery) {
      session.activeQuery.interrupt().catch((err: Error) => {
        log.error("Failed to interrupt query during cancellation", { sessionId, error: String(err) });
      });
    }
    // Clear question timeout and unblock any pending question
    if (session.questionTimeout) {
      clearTimeout(session.questionTimeout);
      session.questionTimeout = null;
    }
    if (session.pendingQuestion) {
      session.pendingQuestion.resolve({});
      session.pendingQuestion = null;
    }
  }
}

export function isActive(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  return session?.activeQuery !== null && session?.activeQuery !== undefined;
}

/**
 * Inject a message into an active query using streamInput.
 * Returns true if injected, false if no active query (caller should fall back to submitQuery).
 */
export async function injectMessage(
  sessionId: string,
  content: string,
  imageIds?: string[],
): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session?.activeQuery) {
    return false;
  }

  try {
    const userMessage: SDKUserMessage = {
      type: 'user' as const,
      message: { role: 'user', content },
      session_id: session.sdkSessionId ?? sessionId,
      parent_tool_use_id: null,
      priority: 'now',
    };

    async function* singleMessage(): AsyncGenerator<SDKUserMessage> {
      yield userMessage;
    }

    await session.activeQuery.streamInput(singleMessage());
    log.info('Injected message into active query', { sessionId, contentLength: content.length, hasImages: !!imageIds?.length });
    return true;
  } catch (error) {
    log.error('Failed to inject message', { sessionId, error: String(error) });
    return false;
  }
}

export function getActiveSessions(): string[] {
  return [...sessions.entries()]
    .filter(([, s]) => s.activeQuery !== null)
    .map(([id]) => id);
}

export function disconnectSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session?.activeQuery) {
    session.activeQuery.interrupt().catch((err: Error) => {
      log.error("Failed to interrupt query during disconnect", { sessionId, error: String(err) });
    });
    session.activeQuery.close();
  }
  eventLog.clear(sessionId);
  sessions.delete(sessionId);
}

export function sendQuestionResponse(sessionId: string, response: Record<string, unknown>): void {
  const session = sessions.get(sessionId);
  if (session?.pendingQuestion) {
    if (session.questionTimeout) {
      clearTimeout(session.questionTimeout);
      session.questionTimeout = null;
    }
    session.pendingQuestion.resolve(response);
    session.pendingQuestion = null;
  }
}

export function getPendingQuestion(sessionId: string): Record<string, unknown> | null {
  const session = sessions.get(sessionId);
  return session?.pendingQuestion?.data ?? null;
}

export function getStreamingContent(sessionId: string): string {
  const session = sessions.get(sessionId);
  return session?.streamingContent ?? '';
}

export function getSessionTodos(sessionId: string): Array<{ content: string; status: string; priority?: string }> | null {
  const session = sessions.get(sessionId);
  return session?.latestTodos ?? null;
}
