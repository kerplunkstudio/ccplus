/**
 * captain.ts
 *
 * Captain: Persistent SDK session that orchestrates the cc+ fleet.
 * Uses async queue to bridge push-based message sources (web, Telegram, Discord, fleet events)
 * to the SDK's AsyncIterable prompt interface.
 */

import { query, createSdkMcpServer, tool, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as config from "./config.js";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as fleetMonitor from "./fleet-monitor.js";
import { log } from "./logger.js";
import { startSession } from "./session-api.js";
import { saveCaptainState as persistCaptainState } from './state-persistence.js';

// ---- Types ----

export type MessageSource = 'web' | 'telegram' | 'discord' | 'fleet' | 'api';

export interface ResponseCallback {
  readonly onText: (text: string, messageIndex: number) => void;
  readonly onThinking: (thinking: string) => void;
  readonly onComplete: () => void;
  readonly onError: (message: string) => void;
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
};

let captainDeps: CaptainDependencies | null = null;

// ---- MCP Server ----

/**
 * Create the fleet control MCP server with tools for session management.
 */
function buildFleetMcpServer(dependencies: CaptainDependencies) {
  return createSdkMcpServer({
    name: "fleet-control",
    version: "1.0.0",
    tools: [
      // list_sessions - Get all sessions from fleet monitor
      tool(
        "list_sessions",
        "List all active and recent sessions in the fleet with status, tool counts, duration, and workspace information",
        {},
        async () => {
          const fleetState = fleetMonitor.getFleetState();
          const sessions = fleetState.sessions.map((s: fleetMonitor.FleetSessionInfo) => ({
            session_id: s.sessionId,
            status: s.status,
            workspace: s.workspace,
            tool_count: s.toolCount,
            active_agents: s.activeAgents,
            input_tokens: s.inputTokens,
            output_tokens: s.outputTokens,
            duration_ms: s.durationMs,
            started_at: s.startedAt,
            last_activity: s.lastActivity,
            label: s.label,
            files_touched: s.filesTouched,
          }));

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  sessions,
                  aggregate: fleetState.aggregate,
                }, null, 2),
              },
            ],
          };
        }
      ),

      // start_session - Start a new coding session
      tool(
        "start_session",
        "Start a new coding session with a specific prompt and workspace. Returns the session_id. Always append these rules to the prompt: 'RULES: Do NOT create branches, PRs, or push. You are in a worktree. Just implement, test, and commit.'",
        {
          prompt: z.string().describe("The task prompt for the session"),
          workspace: z.string().describe("Absolute path to the workspace/project directory"),
          session_id: z.string().optional().describe("Optional session ID (alphanumeric, dots, dashes, underscores only). If not provided, a UUID will be generated."),
        },
        async (args) => {
          // Append mandatory rules to the prompt
          const rulesFooter = "\n\nRULES: Do NOT create branches, PRs, or push. You are in a worktree. Just implement, test, and commit.";
          const fullPrompt = args.prompt + rulesFooter;

          const result = startSession(
            {
              prompt: fullPrompt,
              workspace: args.workspace,
              sessionId: args.session_id,
              requestedBy: getLastQuerySource() ?? undefined,
            },
            dependencies
          );

          if (result.success) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    session_id: result.sessionId,
                    message: `Session ${result.sessionId} started successfully`,
                  }, null, 2),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: result.error,
                  }, null, 2),
                },
              ],
            };
          }
        }
      ),

      // get_session_detail - Get conversation history and tool events for a session
      tool(
        "get_session_detail",
        "Get detailed conversation history and tool events for a specific session",
        {
          session_id: z.string().describe("The session ID to query"),
        },
        async (args) => {
          try {
            const messages = dependencies.database.getConversationHistory(args.session_id, 100);
            const toolEvents = dependencies.database.getToolEvents(args.session_id, 200);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    session_id: args.session_id,
                    messages: messages.map((m) => ({
                      role: m.role,
                      content: (m.content as string).slice(0, 500),
                      timestamp: m.timestamp,
                    })),
                    tool_events: toolEvents.map((t) => ({
                      tool_name: t.tool_name,
                      success: t.success,
                      duration_ms: t.duration_ms,
                      timestamp: t.timestamp,
                      agent_type: t.agent_type,
                    })),
                  }, null, 2),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Failed to get session detail: ${String(error)}`,
                  }, null, 2),
                },
              ],
            };
          }
        }
      ),

      // cancel_session - Cancel a running session
      tool(
        "cancel_session",
        "Cancel an active session's running query",
        {
          session_id: z.string().describe("The session ID to cancel"),
        },
        async (args) => {
          try {
            dependencies.sdkSession.cancelQuery(args.session_id);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    message: `Session ${args.session_id} cancellation requested`,
                  }, null, 2),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: String(error),
                  }, null, 2),
                },
              ],
            };
          }
        }
      ),

      // get_fleet_stats - Get aggregate statistics from fleet monitor + database
      tool(
        "get_fleet_stats",
        "Get aggregate fleet statistics including historical data from the database",
        {},
        async () => {
          const fleetState = fleetMonitor.getFleetState();
          const dbStats = dependencies.database.getStats();

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  current_fleet: fleetState.aggregate,
                  historical: {
                    total_conversations: dbStats.total_conversations,
                    total_tool_events: dbStats.total_tool_events,
                    events_by_tool: dbStats.events_by_tool,
                  },
                }, null, 2),
              },
            ],
          };
        }
      ),
    ],
  });
}

// ---- System Prompt ----

const CAPTAIN_SYSTEM_PROMPT = `
You are Captain, the fleet orchestrator for cc+. Your job is to expand user requests and delegate to sessions — not to research or implement yourself.

## The Golden Rule
NEVER read files, search code, grep, or explore the codebase yourself.
Sessions have Opus-class explorers that handle all of that. Trust them.

## Your Workflow (always follow this)
1. **Check memory** — call mcp__memory__memory_search for project context, past decisions, relevant files
2. **Expand the query** — turn the user's request into a precise, detailed session prompt with:
   - Exact files to modify (from memory or prior session context)
   - Acceptance criteria (what "done" looks like)
   - Constraints (what NOT to change)
   - Context the session won't have (why this change matters)
3. **Delegate** — call start_session with the expanded prompt
4. **Monitor** — watch tool counts and file writes; intervene if stuck (>30 tools, no writes)
5. **Report** — summarize what the session did when it completes

## Starting Sessions
- Session IDs must be specific and self-describing. Format: <type>-<component>-<what-changes>. Examples:
  - "feat-telegram-bridge-voice-transcription"
  - "fix-captain-ts-cancel-not-terminating"
  - "refactor-config-ts-captain-model-default"
  - "fix-fleet-monitor-session-status-update"
  Bad: "fix-captain-routing-model", "feat-voice", "update-prompt"
  Good: "fix-captain-ts-source-routing-callbacks", "feat-telegram-bridge-whisper-local"
- Write precise, detailed prompts. Bad prompt = bad session. Include:
  - Exact files to modify (paths, not vague references)
  - Acceptance criteria (what "done" looks like)
  - Constraints (don't touch X, must be backwards-compatible, etc.)
  - Context the agent won't have (why this change matters, related recent changes)
- See Parallelization section below — this is NOT optional

## Parallelization (CRITICAL)
Before writing a session prompt, decompose the task:
1. List all subtasks
2. Identify dependencies between them (does B need A's output?)
3. If subtasks are independent — launch them as SEPARATE parallel sessions
4. If subtasks have sequential dependencies — combine into ONE session

Examples:
- "Refactor database.ts, sdk-session.ts, and server.ts" → 3 sessions (independent files, barrel re-exports preserve API)
- "Add new DB table then build API routes that query it" → 1 session (routes depend on table)
- "Fix bug in auth + add feature to settings" → 2 sessions (unrelated)
- "Update types.ts then update all consumers" → 1 session (consumers depend on type changes)

Cost of under-parallelizing: slower execution, wasted context window
Cost of over-parallelizing: merge conflicts on shared files

Rule of thumb: if files don't import from each other, parallelize.

## Monitoring & Intervention
- Sessions with >30 tool calls but no file writes are likely stuck — cancel and retry
- Sessions running >5 min on simple tasks need investigation
- Multiple failures on the same task = change approach, not just retry
- After completion: verify files_touched match what was expected

## Memory
- ALWAYS search memory before answering questions about projects, past work, or prior sessions
- Memory is the source of truth for project context — never guess or assume

## MCP Tool Failures
MCP tools (fleet-control, memory) can fail transiently with "Stream closed", timeout, or connection errors — the server auto-respawns within seconds.
- **Always retry silently first** — on any MCP tool failure, retry the exact same call once before doing anything else
- **Do NOT tell the user** about the failure unless the retry also fails
- **After 2 consecutive failures**: inform the user briefly (e.g. "Fleet control is temporarily unavailable, retrying…") — no panic, no asking them to restart
- **Never say "crashed" or "dead"** — use neutral language: "temporarily unavailable", "reconnecting"

## Response Style
- Direct and concise — no filler
- [TELEGRAM:...] or [DISCORD:...] messages: bullet points, 2-3 lines max, no code blocks unless asked
- Lead with action or answer, not reasoning
- When asked about fleet state, call list_sessions first
`.trim();

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

    // Generate Captain session ID with timestamp
    const sessionId = `captain-${Date.now()}`;

    // Build MCP server for fleet control
    const fleetMcpServer = buildFleetMcpServer(captainDeps);

    // Boot message
    const bootMessage = "You are now active as the Fleet Captain. Acknowledge silently — do not produce any output.";

    log.info("Starting Captain session", { sessionId, workspace });

    // Start boot query
    const q = query({
      prompt: bootMessage,
      options: {
        model: config.CAPTAIN_MODEL,
        cwd: workspace,
        settingSources: ['user'],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: CAPTAIN_SYSTEM_PROMPT,
        } as any,
        mcpServers: {
          "fleet-control": fleetMcpServer,
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
    };

    // Process boot query in background
    processQueryResponse(q, sessionId).catch((error) => {
      log.error("Captain boot query error", { sessionId, error: String(error) });
    });

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
  // Capture routing target at the START (before any awaits)
  const routeToCallbackId = captainState.lastQueryCallbackId;
  let messageIndex = 0;

  try {
    for await (const message of q) {
      if (message.type === "assistant") {
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
          }
        }

        const fullText = textBlocks.join("");
        if (fullText.length > 0) {
          // Send to target callback(s)
          for (const callback of getTargetCallbacks(routeToCallbackId)) {
            try {
              callback.onText(fullText, messageIndex);
            } catch (error) {
              log.error("Captain callback error (onText)", { error: String(error) });
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

        // Send completion to target callback(s)
        for (const callback of getTargetCallbacks(routeToCallbackId)) {
          try {
            callback.onComplete();
          } catch (error) {
            log.error("Captain callback error (onComplete)", { error: String(error) });
          }
        }

        log.info("Captain query completed", { sessionId, numTurns: result.num_turns });
      }
    }
  } catch (error) {
    log.error("Captain query error", { sessionId, error: String(error) });

    // Send error to target callback(s)
    for (const callback of getTargetCallbacks(routeToCallbackId)) {
      try {
        callback.onError(String(error));
      } catch (err) {
        log.error("Captain callback error (onError)", { error: String(err) });
      }
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
 * Tags content based on source and starts a new query with resume.
 */
export function sendCaptainMessage(content: string, source: MessageSource, sourceId: string): void {
  if (!captainState.sessionId) {
    throw new Error("Captain session is not active");
  }

  // Tag content by source
  let taggedContent = content;
  if (source === 'fleet') {
    taggedContent = `[FLEET] ${content}`;
  } else if (source === 'telegram' || source === 'discord') {
    taggedContent = `[${source.toUpperCase()}:${sourceId}] ${content}`;
  }
  // 'web' and 'api' get no prefix

  // Compute routing target before incrementing message count
  const queryCallbackId = (source === 'telegram' || source === 'discord')
    ? `${source}:${sourceId}`
    : null; // web/api → broadcast to all

  // Increment message count and store routing target & source
  captainState = {
    ...captainState,
    messageCount: captainState.messageCount + 1,
    lastQueryCallbackId: queryCallbackId,
    lastQuerySource: { source, sourceId },
  };

  log.info("Captain message queued", { source, sourceId, length: content.length });

  // If a query is active, inject the message instead of waiting
  if (captainState.activeQuery) {
    const userMessage: SDKUserMessage = {
      type: 'user' as const,
      message: { role: 'user', content: taggedContent },
      session_id: captainState.sdkSessionId ?? captainState.sessionId ?? '',
      parent_tool_use_id: null,
      priority: 'now' as const,
    };

    async function* singleMessage() {
      yield userMessage;
    }

    captainState.activeQuery.streamInput(singleMessage()).catch((error: unknown) => {
      log.error('Captain: failed to inject message, falling back to new query', { error: String(error) });
      startCaptainQuery(taggedContent).catch((err: unknown) => {
        log.error('Captain query failed', { error: String(err) });
      });
    });
    return;
  }

  // Start new query with resume
  startCaptainQuery(taggedContent).catch((error) => {
    log.error("Captain query failed", { error: String(error) });
  });
}

/**
 * Start a new Captain query with the given content, resuming the conversation.
 * Waits for any active query to complete first.
 */
async function startCaptainQuery(content: string): Promise<void> {
  // Wait for any active query to finish
  if (captainState.activeQuery) {
    const startWait = Date.now();
    while (captainState.activeQuery && Date.now() - startWait < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // If still active after timeout, notify clients and drop the message
    if (captainState.activeQuery) {
      for (const callback of responseCallbacks.values()) {
        try {
          callback.onError('Captain is busy processing a previous query. Please try again in a moment.');
        } catch {
          // ignore callback errors
        }
      }
      return;
    }
  }

  if (!captainState.sessionId || !captainDeps) {
    return;
  }

  const fleetMcpServer = buildFleetMcpServer(captainDeps);

  const q = query({
    prompt: content,
    options: {
      model: config.CAPTAIN_MODEL,
      cwd: captainState.workspace ?? config.CAPTAIN_WORKSPACE,
      settingSources: ['user'],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: CAPTAIN_SYSTEM_PROMPT,
      } as any,
      mcpServers: {
        "fleet-control": fleetMcpServer,
      } as any,
      resume: captainState.sdkSessionId ?? undefined,
      maxTurns: config.CAPTAIN_MAX_TURNS,
      includePartialMessages: true,
      permissionMode: config.BYPASS_PERMISSIONS ? "bypassPermissions" as any : undefined,
      allowDangerouslySkipPermissions: config.BYPASS_PERMISSIONS,
    },
  });

  const sessionId = captainState.sessionId;

  captainState = {
    ...captainState,
    activeQuery: q,
  };

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
 * Check if a given session ID belongs to the Captain.
 */
export function isCaptainSession(sessionId: string): boolean {
  return sessionId.startsWith("captain-");
}

/**
 * Get Captain status summary.
 */
export function getCaptainStatus(): {
  active: boolean;
  sessionId: string | null;
  uptimeMs: number;
  messageCount: number;
} {
  const active = isCaptainAlive();
  const uptimeMs = captainState.startedAt ? Date.now() - captainState.startedAt : 0;

  return {
    active,
    sessionId: captainState.sessionId,
    uptimeMs,
    messageCount: captainState.messageCount,
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

  // Send as a fleet message (will be tagged with [FLEET] prefix)
  sendCaptainMessage(fleetMessage, 'fleet', 'system');
}
