/**
 * captain.ts
 *
 * Captain: Persistent SDK session that orchestrates the cc+ fleet.
 * Uses async queue to bridge push-based message sources (web, Telegram, Discord, fleet events)
 * to the SDK's AsyncIterable prompt interface.
 */

import { query, createSdkMcpServer, tool, type Query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as config from "./config.js";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as fleetMonitor from "./fleet-monitor.js";
import { log } from "./logger.js";
import { startSession } from "./session-api.js";

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
}

let captainState: CaptainState = {
  sessionId: null,
  activeQuery: null,
  isStarting: false,
  messageCount: 0,
  startedAt: null,
  sdkSessionId: null,
  workspace: null,
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
You are Captain, the fleet orchestrator for cc+. You manage, monitor, and improve coding agent sessions.

## Core Capabilities
- Start new sessions with specific prompts and workspaces
- Monitor all running sessions (tool calls, agents, tokens, status)
- Cancel sessions that are stuck or misbehaving
- Query session history and conversation details
- Provide fleet-wide status summaries

## Starting Sessions
- Use descriptive session IDs (e.g., "feat-auth-refactor", "fix-streaming-bug")
- Write precise, detailed prompts. Bad prompt = bad session. Include:
  - Exact files to modify (paths, not vague references)
  - Acceptance criteria (what "done" looks like)
  - Constraints (don't touch X, must be backwards-compatible, etc.)
  - Context the agent won't have (why this change matters, related recent changes)
- The start_session tool automatically appends mandatory rules about worktree behavior

## Outcome Verification
After a session completes, critically evaluate whether it achieved its goal:
- Check the session's tool calls and file changes — did it modify the right files?
- Look for signs of partial completion (touched some files but not others)
- Look for signs of failure loops (high tool count, repeated reads of the same file, no writes)
- If the outcome is unclear, say so honestly. Never assume success without evidence.

## Failure Analysis
When sessions fail, get stuck, or produce poor results:
- Diagnose the root cause: was the prompt too vague? Wrong files referenced? Missing context?
- Identify the specific point of failure (which tool call, which decision)
- Propose a concrete fix: a better prompt, a different approach, or prerequisite steps
- If a session is looping, cancel it and explain what went wrong before restarting

## Prompt Engineering
Learn from session outcomes to write better prompts:
- If a session wandered or did unnecessary work, the prompt lacked focus — tighten it
- If a session failed because it couldn't find something, the prompt lacked context — add file paths and background
- If a session did the wrong thing, the prompt was ambiguous — be more explicit about what NOT to do
- When the user gives you a vague request, expand it into a well-structured prompt before starting the session

## Proactive Monitoring
Don't just watch passively:
- Sessions with high tool counts (>30) but no file writes are likely stuck — investigate
- Sessions running longer than 5 minutes on simple tasks may need intervention
- Multiple failed sessions on the same task indicate a systemic issue — change approach, don't just retry
- If you notice a pattern across sessions (e.g., a file that always causes problems), surface it to the user

## Communication Style
- Be direct and concise. No filler.
- When reporting status, lead with what matters: what's working, what's not, what needs attention
- When proposing improvements, be specific: "Change the prompt from X to Y because Z"
- When asked about fleet state, use list_sessions first
- When asked about projects, past work, ongoing tasks, or what has been done before, ALWAYS call mcp__memory__memory_search before responding. Search with a relevant query (e.g. "project overview", "current work", "recent sessions"). Never answer project questions from context alone — memory is the source of truth.
`.trim();

// ---- Public API ----

/**
 * Start or resume the Captain's persistent Claude session.
 * Idempotent: returns existing session if already running.
 */
export async function startCaptainSession(
  workspace: string,
  dependencies?: CaptainDependencies
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
        resume: captainState.sdkSessionId ?? undefined,
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
 * Process query response.
 * Extracts text from 'assistant' messages and broadcasts to callbacks.
 * Stores session_id from 'result' messages for resume.
 * No auto-restart - Captain stays alive with stored sdkSessionId.
 */
async function processQueryResponse(q: Query, sessionId: string): Promise<void> {
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
            for (const callback of responseCallbacks.values()) {
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
          // Broadcast to all registered callbacks
          for (const callback of responseCallbacks.values()) {
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
        }

        // Broadcast completion
        for (const callback of responseCallbacks.values()) {
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

    // Broadcast error
    for (const callback of responseCallbacks.values()) {
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

  // Increment message count
  captainState = {
    ...captainState,
    messageCount: captainState.messageCount + 1,
  };

  log.info("Captain message queued", { source, sourceId, length: content.length });

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
