/**
 * captain.ts
 *
 * Captain: Persistent SDK session that orchestrates the cc+ fleet.
 * Uses async queue to bridge push-based message sources (web, Telegram, Discord, fleet events)
 * to the SDK's AsyncIterable prompt interface.
 */

import { query, createSdkMcpServer, type Query } from "@anthropic-ai/claude-agent-sdk";
import * as config from "./config.js";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as fleetMonitor from "./fleet-monitor.js";
import { log } from "./logger.js";
import { saveCaptainState as persistCaptainState, removeCaptainState } from './state-persistence.js';
import { buildCaptainSystemPrompt, isIdleMessage, prewarmPromptCache } from './captain-prompt.js';
import { buildFleetMcpTools, type CaptainToolDependencies } from './captain-tools.js';
import { resetBriefMode, shouldSuppressBriefOutput, notifyRateLimit, resetBackoff, notifySessionCompleted } from './captain-tick.js';
import { incrementSessionStaleness } from './memory-promotion.js';
import type { InteractiveMessage, InteractiveResponse } from './interactive-message.js';

// ---- Types ----

export type MessageSource = 'web' | 'telegram' | 'discord' | 'fleet' | 'api' | 'tick';

export interface ResponseCallback {
  readonly onText: (text: string, messageIndex: number) => void;
  readonly onThinking: (thinking: string) => void;
  readonly onComplete: () => void;
  readonly onError: (message: string) => void;
  readonly onToolUse?: (toolName: string, toolInput?: Record<string, unknown>) => void;
}

export interface InteractiveMessageCallback {
  readonly onInteractiveMessage: (message: InteractiveMessage) => void;
}

interface CaptainDependencies {
  database: typeof database;
  sdkSession: typeof sdkSession;
  sessionWorkspaces: Map<string, string>;
  io: unknown;
  buildSocketCallbacks: (sessionId: string, projectPath?: string) => unknown;
  log: typeof log;
}

// ---- State ----

const responseCallbacks = new Map<string, ResponseCallback>();

// Map of messageId -> { message, resolve, timer? }
const pendingInteractiveMessages = new Map<string, {
  readonly message: InteractiveMessage
  readonly resolve: (response: InteractiveResponse) => void
  readonly timer?: ReturnType<typeof setTimeout>
}>();

// Interactive message broadcast callbacks (web sockets register here)
const interactiveCallbacks = new Map<string, InteractiveMessageCallback>();

interface CaptainState {
  readonly sessionId: string | null;
  readonly activeQuery: Query | null;
  readonly isStarting: boolean;
  readonly messageCount: number;
  readonly startedAt: number | null;
  readonly sdkSessionId: string | null;
  readonly workspace: string | null;
  readonly lastQueryCallbackId: string | null;
  readonly lastQuerySource: { source: string; sourceId: string } | null;
  readonly lastQueryIsTick: boolean;
  readonly lastInputTokens: number;
  readonly totalInputTokens: number;
}

let captainState: CaptainState = {
  sessionId: null,
  activeQuery: null,
  isStarting: false,
  messageCount: 0,
  startedAt: null,
  sdkSessionId: null,
  workspace: null,
  lastQueryCallbackId: null,
  lastQuerySource: null,
  lastQueryIsTick: false,
  lastInputTokens: 0,
  totalInputTokens: 0,
};

let captainDeps: CaptainDependencies | null = null;
let fleetMcpServer: ReturnType<typeof createSdkMcpServer> | null = null;

interface QueuedMessage {
  readonly content: string;
  readonly source: MessageSource;
  readonly sourceId: string;
  readonly imageIds?: string[];
}

const messageQueue: QueuedMessage[] = [];
let isProcessingQueue = false;

// ---- MCP Server ----

/**
 * Create the fleet control MCP server with tools for session management.
 */
function buildFleetMcpServer(dependencies: CaptainDependencies) {
  const toolDeps: CaptainToolDependencies = {
    ...dependencies,
    getLastQuerySource,
  };
  return createSdkMcpServer({
    name: "fleet-control",
    version: "1.0.0",
    tools: buildFleetMcpTools(toolDeps),
  });
}

/**
 * Get the fleet MCP server singleton.
 * Creates it on first call if dependencies are available.
 */
function getFleetMcpServer(): ReturnType<typeof createSdkMcpServer> {
  if (!fleetMcpServer && captainDeps) {
    fleetMcpServer = buildFleetMcpServer(captainDeps);
  }
  if (!fleetMcpServer) {
    throw new Error("Fleet MCP server not initialized");
  }
  return fleetMcpServer;
}


// ---- Public API ----

/**
 * Start or resume the Captain's persistent Claude session.
 * Idempotent: returns existing session if already running.
 */
export async function startCaptainSession(
  workspace: string,
  dependencies?: CaptainDependencies,
  resumeSdkSessionId?: string
): Promise<{ sessionId: string }> {
  // If Captain is already running, return existing session ID
  if (captainState.sessionId && !captainState.isStarting) {
    log.info("Captain session already running", { sessionId: captainState.sessionId });
    return { sessionId: captainState.sessionId };
  }

  // Prevent concurrent starts
  if (captainState.isStarting) {
    throw new Error("Captain session is already starting");
  }

  captainState = {
    ...captainState,
    isStarting: true,
  };

  try {
    // Store dependencies if provided
    if (dependencies) {
      captainDeps = dependencies;
    }

    if (!captainDeps) {
      throw new Error("Captain dependencies not provided");
    }

    // Clear callback maps on restart to prevent leaks
    clearResponseCallbacks();
    clearInteractiveCallbacks();
    clearPendingInteractiveMessages();

    // Generate Captain session ID with timestamp
    const sessionId = `captain-${Date.now()}`;

    // Boot message
    const bootMessage = "You are now active as the Fleet Captain. Acknowledge silently — do not produce any output.";

    log.info("Starting Captain session", { sessionId, workspace });

    // Start boot query
    const bootStart = performance.now();
    const captainPrompt = await buildCaptainSystemPrompt(workspace);
    log.info("Captain boot: prompt ready", { duration_ms: Math.round(performance.now() - bootStart) });
    const q = query({
      prompt: bootMessage,
      options: {
        model: config.getCaptainModel(),
        cwd: workspace,
        settingSources: [], // Captain only needs fleet-control MCP, not user-configured MCPs (avoids stdio spawn cost)
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: captainPrompt,
        } as any,
        mcpServers: {
          "fleet-control": getFleetMcpServer(),
        } as any,
        resume: resumeSdkSessionId ?? captainState.sdkSessionId ?? undefined,
        maxTurns: config.CAPTAIN_MAX_TURNS,
        includePartialMessages: true,
        permissionMode: config.BYPASS_PERMISSIONS ? "bypassPermissions" as any : undefined,
        allowDangerouslySkipPermissions: config.BYPASS_PERMISSIONS,
      },
    });

    // Update state
    captainState = {
      sessionId,
      activeQuery: q,
      isStarting: false,
      messageCount: 0,
      startedAt: Date.now(),
      sdkSessionId: captainState.sdkSessionId,
      workspace,
      lastQueryCallbackId: null,
      lastQuerySource: null,
      lastQueryIsTick: false,
      lastInputTokens: 0,
      totalInputTokens: 0,
    };

    // Process boot query in background
    processQueryResponse(q, sessionId).catch((error) => {
      log.error("Captain boot query error", { sessionId, error: String(error) });
    });

    // Pre-warm prompt cache in background so first user message hits cache
    prewarmPromptCache(workspace).catch((error) => {
      log.warn("Captain: failed to pre-warm prompt cache", { error: String(error) });
    });

    log.info("Captain boot: total setup", { duration_ms: Math.round(performance.now() - bootStart) });

    return { sessionId };
  } catch (error) {
    captainState = {
      ...captainState,
      isStarting: false,
    };
    throw error;
  }
}

/**
 * Get target callbacks based on routing ID.
 * If routeToId is non-null, returns only that callback (if registered).
 * If routeToId is null, broadcasts to all callbacks.
 */
function getTargetCallbacks(routeToId: string | null): ResponseCallback[] {
  if (routeToId !== null) {
    const cb = responseCallbacks.get(routeToId);
    return cb ? [cb] : [];
  }
  return Array.from(responseCallbacks.values());
}

/**
 * Process query response.
 * Extracts text from 'assistant' messages and broadcasts to callbacks.
 * Stores session_id from 'result' messages for resume.
 * No auto-restart - Captain stays alive with stored sdkSessionId.
 */
async function processQueryResponse(q: Query, sessionId: string): Promise<void> {
  // Capture routing target and tick flag at the START (before any awaits)
  const routeToCallbackId = captainState.lastQueryCallbackId;
  const isTickQuery = captainState.lastQueryIsTick;
  let messageIndex = 0;
  const responseStart = performance.now();
  let firstTokenLogged = false;

  try {
    for await (const message of q) {
      if (!firstTokenLogged) {
        log.info("Captain query: time to first message", { duration_ms: Math.round(performance.now() - responseStart), sessionId });
        firstTokenLogged = true;
      }
      if ((message as any).type === 'rate_limit_event') {
        const rateLimitMsg = message as any;
        const retryAfterMs = rateLimitMsg.retry_after_ms ?? 0;
        log.warn('Captain received rate_limit_event', { sessionId, retryAfterMs });
        notifyRateLimit(retryAfterMs > 0 ? retryAfterMs : undefined);
        continue;
      } else if ((message as any).type === 'system' && (message as any).subtype === 'compact_boundary') {
        log.warn('Captain context compaction detected', {
          sessionId,
          lastInputTokens: captainState.lastInputTokens,
          totalInputTokens: captainState.totalInputTokens,
        });
      } else if (message.type === "assistant") {
        messageIndex++;
        const msg = message as any;
        const textBlocks: string[] = [];

        for (const block of (msg.message?.content ?? [])) {
          if (block.type === "text") {
            textBlocks.push(block.text);
          } else if (block.type === "thinking" && block.thinking) {
            for (const callback of getTargetCallbacks(routeToCallbackId)) {
              try {
                callback.onThinking(block.thinking);
              } catch (error) {
                log.error("Captain callback error (onThinking)", { error: String(error) });
              }
            }
          } else if (block.type === "tool_use") {
            for (const callback of getTargetCallbacks(routeToCallbackId)) {
              try {
                callback.onToolUse?.(block.name, block.input as Record<string, unknown>);
              } catch (error) {
                log.error("Captain callback error (onToolUse)", { error: String(error) });
              }
            }
          }
        }

        const fullText = textBlocks.join("");
        if (fullText.length > 0) {
          // Always save to DB for observability
          try {
            const convId = database.getLatestCaptainConversationId() ?? `captain-conv-${Date.now()}`;
            database.saveCaptainMessage({
              conversationId: convId,
              role: "assistant",
              content: fullText,
              messageIndex,
            });
          } catch (err) {
            log.error("Failed to save captain assistant message", { error: String(err) });
          }

          // Stealth mode: tick responses NEVER reach chat UI
          // Non-tick responses still filter idle messages
          if (!isTickQuery && !isIdleMessage(fullText)) {
            for (const callback of getTargetCallbacks(routeToCallbackId)) {
              try {
                callback.onText(fullText, messageIndex);
              } catch (error) {
                log.error("Captain callback error (onText)", { error: String(error) });
              }
            }
          }
        }
      } else if (message.type === "result") {
        const result = message as any;

        // Store SDK session ID for resume
        if (result.session_id) {
          captainState = {
            ...captainState,
            sdkSessionId: result.session_id,
          };
          // Persist state for resume on next startup
          if (captainState.sessionId) {
            persistCaptainState(
              {
                sessionId: captainState.sessionId,
                sdkSessionId: result.session_id,
                workspace: captainState.workspace ?? '',
                savedAt: Date.now(),
              },
              config.CAPTAIN_STATE_PATH
            )
          }
        }

        // Extract token usage
        const usageObj = (result as any).usage ?? {};
        const currentInputTokens = (usageObj.input_tokens || 0)
          + (usageObj.cache_read_input_tokens || 0)
          + (usageObj.cache_creation_input_tokens || 0);

        captainState = {
          ...captainState,
          lastInputTokens: currentInputTokens,
          totalInputTokens: captainState.totalInputTokens + currentInputTokens,
        };

        const contextPct = (currentInputTokens / config.CAPTAIN_CONTEXT_WINDOW) * 100;
        log.info('Captain token usage', {
          sessionId,
          inputTokens: currentInputTokens,
          cacheRead: usageObj.cache_read_input_tokens || 0,
          cacheCreation: usageObj.cache_creation_input_tokens || 0,
          totalInputTokens: captainState.totalInputTokens,
          contextPct: Math.round(contextPct * 100) / 100,
        });

        // Record query usage to database
        try {
          // Determine source based on lastQuerySource
          const querySource = captainState.lastQuerySource;
          const isTickQuery = querySource?.source === 'tick';
          const source = isTickQuery ? 'captain-tick' : 'captain';

          database.recordQueryUsage({
            sessionId,
            inputTokens: usageObj.input_tokens || 0,
            outputTokens: usageObj.output_tokens || 0,
            cacheReadInputTokens: usageObj.cache_read_input_tokens || 0,
            cacheCreationInputTokens: usageObj.cache_creation_input_tokens || 0,
            costUsd: (result as any).total_cost_usd || 0,
            durationMs: (result as any).duration_ms || 0,
            model: config.getCaptainModel(),
            projectPath: captainState.workspace,
            source,
          });
        } catch (e) {
          log.error('Failed to record Captain query usage', { sessionId, error: String(e) });
        }

        // Send completion to target callback(s)
        for (const callback of getTargetCallbacks(routeToCallbackId)) {
          try {
            callback.onComplete();
          } catch (error) {
            log.error("Captain callback error (onComplete)", { error: String(error) });
          }
        }

        log.info("Captain query completed", { sessionId, numTurns: result.num_turns, total_duration_ms: Math.round(performance.now() - responseStart) });
      }
    }

    // Loop completed normally — reset backoff so the next tick fires at the base interval
    resetBackoff();
  } catch (error) {
    const errorStr = String(error).toLowerCase();
    const isContextOverflow = errorStr.includes('context') || errorStr.includes('token limit')
      || errorStr.includes('too many tokens') || errorStr.includes('max_tokens');
    const isRateLimit = errorStr.includes('rate limit') || errorStr.includes('429')
      || errorStr.includes('overloaded') || errorStr.includes('too many requests');

    if (isContextOverflow) {
      log.warn('Captain context overflow detected', {
        sessionId,
        lastInputTokens: captainState.lastInputTokens,
        totalInputTokens: captainState.totalInputTokens,
        contextPct: (captainState.lastInputTokens / config.CAPTAIN_CONTEXT_WINDOW) * 100,
        error: String(error),
      });
    }

    if (isRateLimit) {
      log.warn('Captain hit rate limit, activating backoff', { sessionId, error: errorStr });
      notifyRateLimit();
    }

    log.error("Captain query error", { sessionId, error: String(error) });

    // Send error to target callback(s)
    for (const callback of getTargetCallbacks(routeToCallbackId)) {
      try {
        callback.onError(String(error));
      } catch (err) {
        log.error("Captain callback error (onError)", { error: String(err) });
      }
    }

    // Save error message to DB (wrap in try/catch, never throw)
    try {
      const convId = database.getLatestCaptainConversationId() ?? `captain-conv-${Date.now()}`;
      database.saveCaptainMessage({
        conversationId: convId,
        role: "error",
        content: String(error),
      });
    } catch (err) {
      log.error("Failed to save captain error message", { error: String(err) });
    }
  } finally {
    // Just clear activeQuery, DON'T restart. Captain stays alive.
    captainState = {
      ...captainState,
      activeQuery: null,
    };
  }
}

/**
 * Send a message to the Captain session.
 * Tags content based on source and enqueues for serial processing.
 */
export function sendCaptainMessage(content: string, source: MessageSource, sourceId: string, imageIds?: string[]): void {
  if (!captainState.sessionId) {
    throw new Error("Captain session is not active");
  }

  // If captain is waiting on an interactive question, cancel it so the new message can proceed.
  // Expire pending interactive messages (resolves their promises) and interrupt the active query.
  if (pendingInteractiveMessages.size > 0 && captainState.activeQuery) {
    log.info("Captain: new message while interactive question pending, cancelling question", { source });
    expirePendingInteractiveMessages('cancelled');
    captainState.activeQuery.interrupt().catch((error: Error) => {
      log.error("Failed to interrupt Captain query for new message", { error: String(error) });
    });
  }

  // Save user message to DB (skip tick messages — they're noise and pollute refresh)
  if (source !== 'tick') {
    try {
      const existingConvId = database.getLatestCaptainConversationId();
      const convId = existingConvId ?? `captain-conv-${Date.now()}`;
      database.saveCaptainMessage({
        conversationId: convId,
        role: "user",
        content,
        source,
        sourceId,
      });
    } catch (err) {
      log.error("Failed to save captain user message", { error: String(err) });
    }
  }

  // Reset brief mode for any non-tick source
  const isTickSource = source === 'tick';
  if (!isTickSource) {
    resetBriefMode();
  }

  // Tag content by source
  let taggedContent = content;
  if (source === 'fleet') {
    taggedContent = `[FLEET] ${content}`;
  } else if (source === 'telegram' || source === 'discord') {
    taggedContent = `[${source.toUpperCase()}:${sourceId}] ${content}`;
  }

  captainState = {
    ...captainState,
    messageCount: captainState.messageCount + 1,
  };

  log.info("Captain message queued", { source, sourceId, length: content.length, queueDepth: messageQueue.length });

  // Enqueue and kick off processing
  messageQueue.push({ content: taggedContent, source, sourceId, imageIds });
  processMessageQueue();
}

/**
 * Process the message queue serially. Only one query runs at a time.
 * Prevents MCP transport race when tick + fleet messages fire simultaneously.
 */
function processMessageQueue(): void {
  if (isProcessingQueue || messageQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;
  const msg = messageQueue.shift()!;

  // Set routing state for THIS message (not at enqueue time)
  const queryCallbackId = (msg.source === 'telegram' || msg.source === 'discord')
    ? `${msg.source}:${msg.sourceId}`
    : null;

  captainState = {
    ...captainState,
    lastQueryCallbackId: queryCallbackId,
    lastQuerySource: { source: msg.source, sourceId: msg.sourceId },
    lastQueryIsTick: msg.source === 'tick',
  };

  startCaptainQuery(msg.content, msg.imageIds)
    .catch((error) => {
      log.error("Captain query failed", { error: String(error) });
    })
    .finally(() => {
      isProcessingQueue = false;
      // Process next message if any
      if (messageQueue.length > 0) {
        processMessageQueue();
      }
    });
}

/**
 * Start a new Captain query with the given content, resuming the conversation.
 */
async function startCaptainQuery(content: string, imageIds?: string[]): Promise<void> {
  const queryStart = performance.now();
  if (!captainState.sessionId || !captainDeps) {
    return;
  }

  // Queue guarantees serial execution, but if somehow activeQuery lingers, interrupt it
  if (captainState.activeQuery) {
    log.warn("Captain: activeQuery still set when queue dispatched, interrupting");
    try {
      await captainState.activeQuery.interrupt();
    } catch (error) {
      log.error("Captain: failed to interrupt lingering query", { error: String(error) });
    }
    // Brief wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const promptStart = performance.now();
  const captainPrompt = await buildCaptainSystemPrompt(captainState.workspace ?? config.CAPTAIN_WORKSPACE);
  log.info("Captain query: prompt ready", { duration_ms: Math.round(performance.now() - promptStart) });

  // Build prompt — plain string, or an AsyncIterable message stream when images are attached
  let promptArg: string | AsyncIterable<Record<string, unknown>> = content;
  if (imageIds?.length) {
    const contentBlocks: Record<string, unknown>[] = [];
    for (const imgId of imageIds) {
      try {
        const img = database.getImage(imgId);
        if (img) {
          const data = img.data as Buffer;
          const b64 = data.toString('base64');
          let mediaType = img.mime_type as string;
          if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
          contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } });
        }
      } catch (e) {
        log.error('Captain: failed to load image for query', { imageId: imgId, error: String(e) });
      }
    }
    if (content) {
      contentBlocks.push({ type: 'text', text: content });
    }
    async function* messageStream() {
      yield { type: 'user', message: { role: 'user', content: contentBlocks } };
    }
    promptArg = messageStream();
  }

  const sdkStart = performance.now();
  const q = query({
    prompt: promptArg as any,
    options: {
      model: config.getCaptainModel(),
      cwd: captainState.workspace ?? config.CAPTAIN_WORKSPACE,
      settingSources: [], // Captain only needs fleet-control MCP, not user-configured MCPs (avoids stdio spawn cost)
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: captainPrompt,
      } as any,
      mcpServers: {
        "fleet-control": getFleetMcpServer(),
      } as any,
      resume: captainState.sdkSessionId ?? undefined,
      maxTurns: config.CAPTAIN_MAX_TURNS,
      includePartialMessages: true,
      permissionMode: config.BYPASS_PERMISSIONS ? "bypassPermissions" as any : undefined,
      allowDangerouslySkipPermissions: config.BYPASS_PERMISSIONS,
    },
  });
  log.info("Captain query: SDK query created", { duration_ms: Math.round(performance.now() - sdkStart) });

  const sessionId = captainState.sessionId;

  captainState = {
    ...captainState,
    activeQuery: q,
  };

  log.info("Captain query: total setup", { duration_ms: Math.round(performance.now() - queryStart) });
  await processQueryResponse(q, sessionId);
}

/**
 * Register a callback for Captain responses.
 */
export function registerResponseCallback(id: string, callback: ResponseCallback): void {
  responseCallbacks.set(id, callback);
  log.info("Captain response callback registered", { id });
}

/**
 * Unregister a callback for Captain responses.
 */
export function unregisterResponseCallback(id: string): void {
  responseCallbacks.delete(id);
  log.info("Captain response callback unregistered", { id });
}

/**
 * Clear all response callbacks.
 * Used on Captain restart to prevent memory leaks.
 */
export function clearResponseCallbacks(): void {
  const count = responseCallbacks.size;
  responseCallbacks.clear();
  if (count > 0) {
    log.info("Cleared all Captain response callbacks", { count });
  }
}

/**
 * Check if a response callback with the given ID exists.
 */
export function hasResponseCallback(id: string): boolean {
  return responseCallbacks.has(id);
}

/**
 * Register a callback for interactive messages.
 */
export function registerInteractiveCallback(id: string, callback: InteractiveMessageCallback): void {
  interactiveCallbacks.set(id, callback);
  log.info("Captain interactive callback registered", { id });
}

/**
 * Unregister a callback for interactive messages.
 */
export function unregisterInteractiveCallback(id: string): void {
  interactiveCallbacks.delete(id);
  log.info("Captain interactive callback unregistered", { id });
}

/**
 * Clear all interactive callbacks.
 * Used on Captain restart to prevent memory leaks.
 */
export function clearInteractiveCallbacks(): void {
  const count = interactiveCallbacks.size;
  interactiveCallbacks.clear();
  if (count > 0) {
    log.info("Cleared all Captain interactive callbacks", { count });
  }
}

/**
 * Emit an interactive message to all registered callbacks.
 */
export function emitInteractiveMessage(message: InteractiveMessage): void {
  for (const callback of interactiveCallbacks.values()) {
    try {
      callback.onInteractiveMessage(message);
    } catch (error) {
      log.error("Captain interactive callback error", { error: String(error) });
    }
  }
}

/**
 * Register a pending interactive message that's waiting for user response.
 */
export function registerPendingInteractiveMessage(
  messageId: string,
  entry: {
    readonly message: InteractiveMessage
    readonly resolve: (response: InteractiveResponse) => void
    readonly timer?: ReturnType<typeof setTimeout>
  }
): void {
  pendingInteractiveMessages.set(messageId, entry);
}

/**
 * Respond to a pending interactive message.
 * Returns true if the message was found and responded to, false otherwise.
 */
export function respondToInteractiveMessage(messageId: string, response: InteractiveResponse): boolean {
  const pending = pendingInteractiveMessages.get(messageId);
  if (!pending) {
    log.warn("No pending interactive message found", { messageId });
    return false;
  }
  clearTimeout(pending.timer);
  pendingInteractiveMessages.delete(messageId);
  pending.resolve(response);
  log.info("Interactive message responded", { messageId, actionId: response.actionId });
  return true;
}

/**
 * Get a pending interactive message by ID for validation purposes.
 * Returns the InteractiveMessage if pending, undefined otherwise.
 */
export function getPendingInteractiveMessage(messageId: string): InteractiveMessage | undefined {
  return pendingInteractiveMessages.get(messageId)?.message;
}

/**
 * Expire all pending interactive messages with a given reason.
 * Used on socket disconnect or cancellation to prevent dangling promises.
 */
export function expirePendingInteractiveMessages(reason: 'disconnected' | 'cancelled' = 'disconnected'): void {
  for (const [messageId, pending] of pendingInteractiveMessages.entries()) {
    clearTimeout(pending.timer);
    pendingInteractiveMessages.delete(messageId);
    pending.resolve({
      messageId,
      actionId: `__${reason}__`,
      respondedAt: Date.now(),
      source: 'api',
    });
    log.info('Interactive message expired', { messageId, reason });
  }
}

/**
 * Clear all pending interactive messages.
 * Used on Captain restart to prevent memory leaks.
 */
export function clearPendingInteractiveMessages(): void {
  const count = pendingInteractiveMessages.size;
  for (const [messageId, pending] of pendingInteractiveMessages.entries()) {
    clearTimeout(pending.timer);
    pending.resolve({
      messageId,
      actionId: '__cleared__',
      respondedAt: Date.now(),
      source: 'api',
    });
  }
  pendingInteractiveMessages.clear();
  if (count > 0) {
    log.info("Cleared all pending interactive messages", { count });
  }
}

/**
 * Get the current Captain session ID, or null if not running.
 */
export function getCaptainSessionId(): string | null {
  return captainState.sessionId;
}

/**
 * Check if Captain is currently alive (has session ID).
 */
export function isCaptainAlive(): boolean {
  return captainState.sessionId !== null;
}

/**
 * Check if Captain is idle (alive but no active query, not starting).
 */
export function isCaptainIdle(): boolean {
  return captainState.sessionId !== null
    && captainState.activeQuery === null
    && !captainState.isStarting;
}

/**
 * Check if a given session ID belongs to the Captain.
 */
export function isCaptainSession(sessionId: string): boolean {
  return sessionId.startsWith("captain-");
}

/**
 * Cancel the active Captain query by interrupting it.
 * Returns true if a query was interrupted, false if nothing was running.
 */
export function cancelCaptainQuery(): boolean {
  if (!captainState.activeQuery) {
    return false;
  }
  captainState.activeQuery.interrupt().catch((error: Error) => {
    log.error("Failed to interrupt Captain query during cancellation", { error: String(error) });
  });
  return true;
}

/**
 * Reset Captain session - interrupts active query, clears state, removes persisted state,
 * and starts a fresh session with no context.
 */
export async function resetCaptainSession(): Promise<{ sessionId: string }> {
  const workspace = captainState.workspace ?? config.CAPTAIN_WORKSPACE ?? process.cwd();

  // Interrupt active query if running
  if (captainState.activeQuery) {
    try {
      await captainState.activeQuery.interrupt();
    } catch (error) {
      log.error('Failed to interrupt Captain query during reset', { error: String(error) });
    }
    // Give time for interruption to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Clear SDK session ID so startCaptainSession won't resume
  captainState = {
    ...captainState,
    sdkSessionId: null,
    activeQuery: null,
    sessionId: null, // Allow startCaptainSession to create new
    lastInputTokens: 0,
    totalInputTokens: 0,
    messageCount: 0,
  };

  // Remove persisted state file
  removeCaptainState(config.CAPTAIN_STATE_PATH);

  // Clear current conversation messages from DB so refresh doesn't reload old messages
  try {
    const deleted = database.clearCurrentCaptainConversation();
    log.info('Captain reset: cleared DB messages', { deleted });
  } catch (err) {
    log.error('Failed to clear captain messages on reset', { error: String(err) });
  }

  log.info('Captain session reset — starting fresh');

  // Start fresh (no resumeSdkSessionId)
  return startCaptainSession(workspace, captainDeps ?? undefined);
}

/**
 * Get Captain status summary.
 */
export function getCaptainStatus(): {
  active: boolean;
  sessionId: string | null;
  uptimeMs: number;
  messageCount: number;
  lastInputTokens: number;
  totalInputTokens: number;
  contextPct: number;
} {
  const active = isCaptainAlive();
  const uptimeMs = captainState.startedAt ? Date.now() - captainState.startedAt : 0;

  return {
    active,
    sessionId: captainState.sessionId,
    uptimeMs,
    messageCount: captainState.messageCount,
    lastInputTokens: captainState.lastInputTokens,
    totalInputTokens: captainState.totalInputTokens,
    contextPct: captainState.lastInputTokens > 0
      ? Math.round((captainState.lastInputTokens / config.CAPTAIN_CONTEXT_WINDOW) * 100 * 100) / 100
      : 0,
  };
}

/**
 * Get the last query source (for tracking session requesters).
 */
export function getLastQuerySource(): { source: string; sourceId: string } | null {
  return captainState.lastQuerySource;
}

/**
 * Get Captain state for persistence (used during shutdown).
 */
export function getCaptainStateForPersistence(): { sessionId: string; sdkSessionId: string; workspace: string } | null {
  if (!captainState.sessionId || !captainState.sdkSessionId) return null
  return {
    sessionId: captainState.sessionId,
    sdkSessionId: captainState.sdkSessionId,
    workspace: captainState.workspace ?? '',
  }
}

/**
 * Notify Captain when a session completes.
 * Injects a fleet message so Captain can send a summary to the requester.
 */
export function notifySessionComplete(sessionId: string, info: { requestedBy?: { source: string; sourceId: string }; filesTouched?: string[] }): void {
  if (!isCaptainAlive()) {
    log.info("Captain not alive, skipping session completion notification", { sessionId });
    return;
  }

  // Only notify if we know who requested it
  if (!info.requestedBy) {
    log.info("Session has no requester info, skipping notification", { sessionId });
    return;
  }

  const { source, sourceId } = info.requestedBy;
  const filesChanged = info.filesTouched && info.filesTouched.length > 0
    ? info.filesTouched.join(', ')
    : 'none';

  const fleetMessage = `Session "${sessionId}" completed. Files changed: ${filesChanged}. Send a brief success summary to [${source.toUpperCase()}:${sourceId}].`;

  log.info("Notifying Captain of session completion", { sessionId, source, sourceId });

  // Decay recent memory access counts on session completion
  try {
    incrementSessionStaleness();
  } catch {
    // Never throw from notification handlers
  }

  // Notify consolidation hint tracker
  try {
    notifySessionCompleted(sessionId, 'completed', info.filesTouched ?? []);
  } catch {
    // Never throw from notification handlers
  }

  // Send as a fleet message (will be tagged with [FLEET] prefix)
  sendCaptainMessage(fleetMessage, 'fleet', 'system');
}

/**
 * Notify Captain when a session appears stuck.
 * Sends a fleet message with diagnostic info to help Captain alert the requester.
 */
export function notifySessionStuck(sessionId: string, info: fleetMonitor.FleetSessionInfo): void {
  if (!isCaptainAlive()) {
    log.info('Captain not alive, skipping stuck session notification', { sessionId });
    return;
  }

  const durationMs = Date.now() - new Date(info.startedAt).getTime();
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  const durationStr = `${minutes}m${seconds}s`;

  const fleetMessage = `[FLEET] Session "${sessionId}" appears stuck: ${info.toolCount} tool calls, ${info.filesTouched.length} files written, running for ${durationStr}. Consider cancelling and retrying with a clearer prompt.`;

  log.info('Notifying Captain of stuck session', { sessionId, toolCount: info.toolCount });

  sendCaptainMessage(fleetMessage, 'fleet', 'system');
}
