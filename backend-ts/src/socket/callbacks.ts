import type { Server as SocketIOServer } from "socket.io";
import { eventLog } from "../event-log.js";
import type { RouteDependencies } from "../routes/types.js";
import {
  startWithholding,
  bufferEvent,
  flushWithheld,
  discardWithheld,
  clearWithholdingState,
  getWithholdingState,
} from "./withholding.js";

// ---- Helper: Build callbacks that emit to Socket.IO room ----
// CRITICAL: All emissions MUST use io.to(sessionId).emit() (room-based, not socket-based)
// This ensures events continue to flow even after socket disconnects/reconnects
// The session room persists across socket instances for the same browser tab

const DELTA_COALESCE_MS = 30;

interface DeltaBuffer {
  text: string;
  messageIndex: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const deltaBuffers = new Map<string, DeltaBuffer>();

function flushDeltaBuffer(
  sessionId: string,
  io: SocketIOServer,
  log: RouteDependencies["log"]
): void {
  const buf = deltaBuffers.get(sessionId);
  if (!buf || !buf.text) return;

  const payload = { session_id: sessionId, text: buf.text, message_index: buf.messageIndex };
  try {
    const logEvent = eventLog.append(sessionId, 'text_delta', payload);
    const fullPayload = { ...payload, seq: logEvent.seq };

    if (getWithholdingState(sessionId).active) {
      bufferEvent(sessionId, "text_delta", fullPayload);
    } else {
      io.to(sessionId).emit("text_delta", fullPayload);
    }
  } catch (e) {
    log?.error("Failed to flush delta buffer", { sessionId, error: String(e) });
  }

  buf.text = '';
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
}

export function clearDeltaBuffer(sessionId: string): void {
  const buf = deltaBuffers.get(sessionId);
  if (buf?.timer) {
    clearTimeout(buf.timer);
  }
  deltaBuffers.delete(sessionId);
}

export function clearSessionState(sessionId: string): void {
  clearDeltaBuffer(sessionId);
  clearWithholdingState(sessionId);
}

export function buildSocketCallbacks(
  sessionId: string,
  projectPath: string | undefined,
  deps: RouteDependencies
) {
  const { io, database, log } = deps;
  if (!io || !database || !log) throw new Error("Missing required dependencies");

  return {
    onText: (text: string, messageIndex: number) => {
      // If withholding was active, new text signals recovery success — discard the buffer
      // so the fresh (clean) response goes through to the frontend without the broken partial
      if (getWithholdingState(sessionId).active) {
        discardWithheld(sessionId);
      }

      let buf = deltaBuffers.get(sessionId);

      if (buf && buf.text && buf.messageIndex !== messageIndex) {
        // Message boundary — flush immediately before starting new message
        flushDeltaBuffer(sessionId, io, log);
        buf = undefined;
      }

      if (!buf) {
        buf = { text: '', messageIndex, timer: null };
        deltaBuffers.set(sessionId, buf);
      }

      buf.text += text;
      buf.messageIndex = messageIndex;

      if (!buf.timer) {
        buf.timer = setTimeout(() => {
          flushDeltaBuffer(sessionId, io, log);
        }, DELTA_COALESCE_MS);
      }
    },
    onToolEvent: (event: Record<string, unknown>) => {
      const payload = { ...event, session_id: sessionId };
      const logEvent = eventLog.append(sessionId, 'tool_event', payload);
      const fullPayload = { ...payload, seq: logEvent.seq };

      if (getWithholdingState(sessionId).active) {
        bufferEvent(sessionId, "tool_event", fullPayload);
      } else {
        io.to(sessionId).emit("tool_event", fullPayload);
      }
      // Count lines of code
      if (event.type === "tool_complete" && (event.tool_name === "Write" || event.tool_name === "Edit")) {
        const params = event.parameters as Record<string, unknown> | undefined;
        const content = (params?.content as string) ?? (params?.new_string as string) ?? "";
        if (content) {
          const lines = content.split("\n").length;
          try {
            database.incrementUserStats("local", 0, 0, 0, 0, 0, 0, lines);
          } catch (e) {
            log.error("Failed to increment LOC", { sessionId, error: String(e) });
          }
        }
      }
    },
    onComplete: (result: Record<string, unknown>) => {
      // Recovery succeeded — discard any withheld events (they are from a partial/failed attempt)
      discardWithheld(sessionId);

      // Flush any pending text_delta buffer before emitting response_complete
      flushDeltaBuffer(sessionId, io, log);
      clearDeltaBuffer(sessionId);

      try {
        database.incrementUserStats(
          "local",
          0,
          1,
          (result.duration_ms as number) ?? 0,
          (result.cost as number) ?? 0,
          (result.input_tokens as number) ?? 0,
          (result.output_tokens as number) ?? 0,
        );
      } catch (e) {
        log.error("Failed to increment user stats", { sessionId, error: String(e) });
      }

      // Record per-query usage for insights dashboard
      try {
        database.recordQueryUsage({
          sessionId,
          inputTokens: (result.input_tokens as number) ?? 0,
          outputTokens: (result.output_tokens as number) ?? 0,
          cacheReadInputTokens: (result.cache_read_input_tokens as number) ?? 0,
          cacheCreationInputTokens: (result.cache_creation_input_tokens as number) ?? 0,
          costUsd: (result.cost as number) ?? 0,
          durationMs: (result.duration_ms as number) ?? 0,
          model: (result.model as string) ?? null,
          projectPath: projectPath ?? null,
        });
      } catch (e) {
        log.error("Failed to record query usage", { sessionId, error: String(e) });
      }

      // Persist session context for tab restoration
      try {
        database.updateSessionContext(
          sessionId,
          (result.input_tokens as number) ?? 0,
          (result.model as string) ?? null
        );
      } catch (e) {
        log.error("Failed to update session context", { sessionId, error: String(e) });
      }

      const payload = {
        cost: result.cost,
        duration_ms: result.duration_ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cache_read_input_tokens: result.cache_read_input_tokens,
        cache_creation_input_tokens: result.cache_creation_input_tokens,
        context_window_size: result.context_window_size,
        model: result.model,
        sdk_session_id: result.sdk_session_id,
        content: result.text,
        message_index: result.message_index,
        session_id: sessionId,
      };
      const event = eventLog.append(sessionId, 'response_complete', payload);
      io.to(sessionId).emit("response_complete", { ...payload, seq: event.seq });
    },
    onError: (message: string) => {
      // Recovery failed — flush any withheld events so the frontend sees the broken partial
      flushWithheld(sessionId, io);

      // Flush any pending text_delta buffer before emitting error
      flushDeltaBuffer(sessionId, io, log);
      clearDeltaBuffer(sessionId);

      const payload = { message, session_id: sessionId };
      const event = eventLog.append(sessionId, 'error', payload);
      io.to(sessionId).emit("error", { ...payload, seq: event.seq });
    },
    onUserQuestion: (data: Record<string, unknown>) => {
      const payload = {
        questions: data.questions ?? [],
        tool_use_id: data.tool_use_id ?? "",
        session_id: sessionId,
      };
      const event = eventLog.append(sessionId, 'user_question', payload);
      io.to(sessionId).emit("user_question", { ...payload, seq: event.seq });
    },
    onSignal: (signal: { type: string; data: Record<string, unknown> }) => {
      io.to(sessionId).emit("signal", signal);
    },
    onToolProgress: (data: { tool_use_id: string; elapsed_seconds: number }) => {
      const payload = { ...data, session_id: sessionId };
      const event = eventLog.append(sessionId, 'tool_progress', payload);
      io.to(sessionId).emit("tool_progress", { ...payload, seq: event.seq });
    },
    onRateLimit: (data: { retryAfterMs: number; rateLimitedAt: string }) => {
      // Rate limits are recoverable — start withholding subsequent text_delta/tool_event
      startWithholding(sessionId, () => {
        log?.warn?.('Withholding safety timeout reached, flushing buffered events', { sessionId });
        flushWithheld(sessionId, io);
      });

      const payload = { ...data, session_id: sessionId };
      const event = eventLog.append(sessionId, 'rate_limit', payload);
      io.to(sessionId).emit("rate_limit", { ...payload, seq: event.seq });
      try {
        database.recordRateLimitEvent(sessionId, data.retryAfterMs);
      } catch (err) {
        log.error('Failed to record rate limit event:', { error: String(err) });
      }
    },
    onPromptSuggestion: (suggestions: string[]) => {
      io.to(sessionId).emit("prompt_suggestions", { suggestions });
    },
    onCompactBoundary: () => {
      io.to(sessionId).emit("compact_boundary", { timestamp: new Date().toISOString() });
    },
    onDevServerDetected: (url: string) => {
      io.to(sessionId).emit("dev_server_detected", { url, session_id: sessionId });
    },
    onCaptureScreenshot: (): Promise<{ image?: string; url?: string; error?: string }> => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ error: "Screenshot timeout - no browser tab responded within 10 seconds" });
        }, 10000);

        // Set up one-time listener for screenshot result
        const handleScreenshotResult = (data: { image?: string; url?: string; error?: string; session_id?: string }) => {
          // Only handle responses for this session
          if (data.session_id === sessionId) {
            clearTimeout(timeout);
            io.off("screenshot_result", handleScreenshotResult);
            resolve(data);
          }
        };

        // Listen for screenshot result
        io.on("screenshot_result", handleScreenshotResult);

        // Request screenshot from frontend
        io.to(sessionId).emit("capture_screenshot", { session_id: sessionId });
      });
    },
    onThinkingStatus: (isThinking: boolean) => {
      io.to(sessionId).emit("thinking_status", { isThinking, session_id: sessionId });
    },
  };
}
