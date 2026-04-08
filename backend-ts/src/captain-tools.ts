/**
 * captain-tools.ts
 *
 * MCP tool definitions for fleet control.
 * Extracted from captain.ts for modularity and testing.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFileSync, statSync } from 'fs';
import { execFileSync, spawn } from 'child_process';
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as fleetMonitor from "./fleet-monitor.js";
import { startSession, createPendingSession } from "./session-api.js";
import { getWorkflowState, transitionPhase, skipToPhase } from "./workflow-state.js";
import { loadWorkflow, listWorkflows } from "./workflow-config.js";
import { log } from "./logger.js";
import * as captain from "./captain.js";
import type { ActionStyle, InteractiveMessage, InteractiveResponse } from './interactive-message.js';
import { randomUUID } from 'crypto';
import { PROJECT_ROOT, DEPLOY_STATE_PATH } from './config.js';
import { saveDeployState } from './state-persistence.js';
import { sleepTicks, getSleepRemaining } from './captain-tick.js';
import { updateCoreMemoryBlock, appendCoreMemory, rethinkCoreMemory, renderCoreMemory, loadCoreMemory, type CoreMemoryBlock } from './captain-memory.js';
import { invalidatePromptCache } from './captain-prompt.js';

// ---- Pricing Constants ----

const MODEL_PRICING = {
  sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
  haiku: { inputPerMTok: 0.80, outputPerMTok: 4 },
  opus: { inputPerMTok: 15, outputPerMTok: 75 },
} as const;

// ---- Pending Session Interactive Storage ----

// Map messageId -> sessionId for interactive session proposals
const pendingSessionInteractives = new Map<string, string>();

function storePendingSessionInteractive(messageId: string, sessionId: string): void {
  pendingSessionInteractives.set(messageId, sessionId);
}

function removePendingSessionInteractive(messageId: string): void {
  pendingSessionInteractives.delete(messageId);
}

export function getPendingSessionForMessage(messageId: string): string | undefined {
  return pendingSessionInteractives.get(messageId);
}

// ---- Types ----

export interface CaptainToolDependencies {
  readonly database: typeof database;
  readonly sdkSession: typeof sdkSession;
  readonly sessionWorkspaces: Map<string, string>;
  readonly io: unknown;
  readonly buildSocketCallbacks: (sessionId: string, projectPath?: string) => unknown;
  readonly log: typeof log;
  readonly getLastQuerySource: () => { source: string; sourceId: string } | null;
}

// ---- Tool Builder ----

export function buildFleetMcpTools(deps: CaptainToolDependencies) {
  return [
    // list_sessions - Get all sessions from fleet monitor
    tool(
      "list_sessions",
      "List sessions in the fleet. Defaults to running/pending/idle only. Pass status filter to include completed/failed/cancelled. files_touched is capped at 5 per session — use get_session_detail for the full list.",
      {
        status: z.array(z.enum(["running", "pending", "idle", "completed", "failed", "cancelled"])).optional()
          .describe("Filter by status. Defaults to ['running', 'pending', 'idle'] to keep output compact. Pass ['running', 'pending', 'idle', 'completed', 'failed', 'cancelled'] to see all."),
      },
      async (args) => {
        const MAX_FILES_TOUCHED = 5;
        const allowedStatuses = new Set(args.status ?? ['running', 'pending', 'idle']);

        try {
          const fleetState = fleetMonitor.getFleetState();
          const filtered = fleetState.sessions.filter(
            (s: fleetMonitor.EnrichedFleetSessionInfo) => allowedStatuses.has(s.status)
          );
          const sessions = filtered.map((s: fleetMonitor.EnrichedFleetSessionInfo) => {
            const filesTouched = s.filesTouched ?? [];
            const truncated = filesTouched.length > MAX_FILES_TOUCHED;
            return {
              id: s.sessionId,
              status: s.status,
              tools: s.toolCount,
              agents: s.activeAgents,
              in_tok: s.inputTokens,
              out_tok: s.outputTokens,
              ms: s.durationMs,
              last: s.lastActivity,
              label: s.label,
              files: filesTouched.slice(0, MAX_FILES_TOUCHED),
              ...(truncated ? { files_total: filesTouched.length } : {}),
              phase: s.workflowPhase ?? null,
              wf: s.workflowName ?? null,
            };
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  sessions,
                  aggregate: fleetState.aggregate,
                  filter: { status: Array.from(allowedStatuses), total_in_fleet: fleetState.sessions.length },
                }),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Failed to list sessions: ${String(error)}`,
                }),
              },
            ],
          };
        }
      }
    ),

    // start_session - Start a new coding session
    tool(
      "start_session",
      "Start a new coding session with a specific prompt and workspace. Returns the session_id.",
      {
        prompt: z.string().describe("The task prompt for the session"),
        workspace: z.string().describe("Absolute path to the workspace/project directory"),
        session_id: z.string().optional().describe("Optional session ID (alphanumeric, dots, dashes, underscores only). If not provided, a UUID will be generated."),
        workflow: z.string().describe("REQUIRED. Workflow to use: 'feature', 'bug-fix', 'tdd', 'security-audit', or 'default'. See Workflow Selection section."),
        force: z.boolean().optional().describe("If true, bypass pending state and start session immediately. If false or omitted (default), session requires user approval before starting."),
        description: z.string().optional().describe("Optional 1-sentence description of what this session is working on (human-readable summary)."),
        originating_session_id: z.string().optional().describe("Session ID that introduced the bug being fixed. Sets up correlation for KAIROS analysis. Only use when this session is fixing a bug caused by a specific prior session."),
      },
      async (args) => {
        try {
          const availableWorkflows = listWorkflows();
          if (!availableWorkflows.includes(args.workflow)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: `Unknown workflow '${args.workflow}'. Available workflows: ${availableWorkflows.join(', ')}`,
                  }),
                },
              ],
            };
          }

          const sessionParams = {
            prompt: args.prompt,
            workspace: args.workspace,
            sessionId: args.session_id,
            requestedBy: deps.getLastQuerySource() ?? undefined,
            workflow: args.workflow,
            description: args.description,
          };

          // If force is true, start session immediately; otherwise create pending session
          const result = args.force === true
            ? startSession(sessionParams, deps)
            : createPendingSession(sessionParams, deps);

          if (result.success && result.sessionId) {
            // Record KAIROS correlation if originating_session_id is provided
            if (args.originating_session_id) {
              try {
                const { addCorrelation } = await import('./db/kairos.js');
                addCorrelation({
                  sourceSessionId: args.originating_session_id,
                  targetSessionId: result.sessionId,
                  relationType: 'bug_fix_for',
                  confidence: 1.0,
                  evidence: `Captain tagged as bug fix for ${args.originating_session_id}`,
                });
                deps.log.info('Recorded KAIROS correlation', {
                  sourceSessionId: args.originating_session_id,
                  targetSessionId: result.sessionId,
                });
              } catch (err) {
                deps.log.warn('Failed to record KAIROS correlation', {
                  error: String(err),
                  sourceSessionId: args.originating_session_id,
                  targetSessionId: result.sessionId,
                });
              }
            }

            // Emit session proposal event to fleet monitor room (only for pending sessions)
            if (args.force !== true) {
              const io = deps.io as any;
              if (io && io.to) {
                io.to('fleet_monitor').emit('session_proposal', {
                  session_id: result.sessionId,
                  prompt: args.prompt,
                  workspace: args.workspace,
                  workflow: args.workflow,
                });
              }

              // Also emit interactive card to Captain chat for pending sessions
              const messageId = randomUUID();
              const sessionLabel = args.prompt.length > 60
                ? `${args.prompt.slice(0, 57)}...`
                : args.prompt;

              const interactiveMessage: InteractiveMessage = {
                id: messageId,
                type: 'status-action',
                text: `Start session: ${sessionLabel}\nWorkflow: ${args.workflow}\nWorkspace: ${args.workspace}`,
                actions: [
                  { id: 'approve', label: 'Accept', style: 'primary' },
                  { id: 'reject', label: 'Reject', style: 'danger' },
                ],
                responseState: 'pending',
                sessionId: result.sessionId,
                createdAt: Date.now(),
              };

              // Store mapping for response handling
              storePendingSessionInteractive(messageId, result.sessionId);

              // Register pending interactive message (no timeout — stays indefinitely)
              captain.registerPendingInteractiveMessage(messageId, {
                message: interactiveMessage,
                resolve: (response: InteractiveResponse) => {
                  removePendingSessionInteractive(messageId);

                  // Handle approve/reject
                  if (response.actionId === 'approve') {
                    deps.log.info('Session proposal approved via interactive card', { sessionId: result.sessionId });
                  } else if (response.actionId === 'reject') {
                    deps.log.info('Session proposal rejected via interactive card', { sessionId: result.sessionId });
                  }
                },
              });

              // Emit to Captain chat
              captain.emitInteractiveMessage(interactiveMessage);
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    session_id: result.sessionId,
                    status: args.force === true ? "running" : "pending",
                    message: args.force === true
                      ? `Session ${result.sessionId} started successfully`
                      : `Session ${result.sessionId} created in pending state — awaiting user approval`,
                  }),
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
                  }),
                },
              ],
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: String(error),
                }),
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
          const messages = deps.database.getConversationHistory(args.session_id, 50);
          const toolEvents = deps.database.getToolEvents(args.session_id, 100);

          const workflow = (() => {
            try {
              const ws = getWorkflowState(args.session_id);
              return {
                name: ws.workflowName,
                phase: ws.phase,
                transitions: ws.transitions,
              };
            } catch {
              return null;
            }
          })();

          const fleet = (() => {
            const detail = fleetMonitor.getSessionDetail(args.session_id);
            if (!detail) return null;
            return {
              files_touched: detail.filesTouched,
              input_tokens: detail.inputTokens,
              output_tokens: detail.outputTokens,
              active_agents: detail.activeAgents,
              duration_ms: detail.durationMs,
            };
          })();

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
                    agent_type: t.agent_type,
                  })),
                  workflow,
                  fleet,
                }),
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
                }),
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
          deps.sdkSession.cancelQuery(args.session_id);
          fleetMonitor.updateSessionStatus(args.session_id, 'cancelled');
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: `Session ${args.session_id} cancellation requested`,
                }),
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
                }),
              },
            ],
          };
        }
      }
    ),

    // resume_session - Send a follow-up message to an existing session
    tool(
      "resume_session",
      "Send a follow-up message to an existing session to continue its work. The session resumes with full conversation context.",
      {
        session_id: z.string().describe("The session ID to resume"),
        prompt: z.string().describe("The follow-up message/instructions"),
      },
      async (args) => {
        try {
          const sessionInfo = fleetMonitor.getSessionDetail(args.session_id);
          if (!sessionInfo) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: "Session not found",
                  }),
                },
              ],
            };
          }

          if (deps.sdkSession.isActive(args.session_id)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: "Session already has an active query",
                  }),
                },
              ],
            };
          }

          const callbacks = deps.buildSocketCallbacks(args.session_id, sessionInfo.workspace) as any;
          deps.sdkSession.submitQuery(
            args.session_id,
            args.prompt,
            sessionInfo.workspace,
            callbacks,
            undefined,
            undefined,
            deps.getLastQuerySource() ?? undefined
          );
          fleetMonitor.updateSessionStatus(args.session_id, 'running');

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  session_id: args.session_id,
                  message: "Session resumed",
                }),
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
                }),
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
        try {
          const fleetState = fleetMonitor.getFleetState();
          const dbStats = deps.database.getStats();

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
                }),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Failed to get fleet stats: ${String(error)}`,
                }),
              },
            ],
          };
        }
      }
    ),

    // get_session_state - Get combined workflow state + fleet detail for a session
    tool(
      "get_session_state",
      "Get the workflow state and fleet monitor details for a specific session",
      {
        session_id: z.string().describe("The session ID to query"),
      },
      async (args) => {
        try {
          const workflowState = getWorkflowState(args.session_id);
          const sessionDetail = fleetMonitor.getSessionDetail(args.session_id);

          let phaseRules: { blocked: string[]; warned: string[] } | null = null;
          try {
            const wfConfig = loadWorkflow(workflowState.workflowName);
            const phaseConfig = wfConfig.phases.find(p => p.name === workflowState.phase);
            if (phaseConfig?.tool_rules) {
              phaseRules = {
                blocked: phaseConfig.tool_rules.filter(r => r.action === 'block').map(r => r.tool_name),
                warned: phaseConfig.tool_rules.filter(r => r.action === 'warn').map(r => r.tool_name),
              };
            }
          } catch {
            // Workflow not found, skip rules
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                session_id: args.session_id,
                workflow: {
                  name: workflowState.workflowName,
                  phase: workflowState.phase,
                  transitions: workflowState.transitions,
                  phase_rules: phaseRules,
                },
                fleet: sessionDetail ? {
                  status: sessionDetail.status,
                  tool_count: sessionDetail.toolCount,
                  active_agents: sessionDetail.activeAgents,
                  input_tokens: sessionDetail.inputTokens,
                  output_tokens: sessionDetail.outputTokens,
                  files_touched: sessionDetail.filesTouched,
                  duration_ms: sessionDetail.durationMs,
                  label: sessionDetail.label,
                  last_activity: sessionDetail.lastActivity,
                } : null,
              }),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: `Failed to get session state: ${String(error)}`,
              }),
            }],
          };
        }
      }
    ),

    // transition_session_phase - Manually advance a session's workflow phase
    tool(
      "transition_session_phase",
      "Manually advance a session's workflow phase. Use 'validate' mode to enforce transition rules or 'force' to skip to any phase.",
      {
        session_id: z.string().describe("The session ID"),
        to_phase: z.string().describe("Target phase (e.g., 'execute', 'test', 'review', 'complete')"),
        mode: z.enum(['validate', 'force']).default('validate').describe("'validate' enforces rules, 'force' skips to any phase"),
        reason: z.string().optional().describe("Why this transition is being made"),
      },
      async (args) => {
        try {
          const currentState = getWorkflowState(args.session_id);
          const workspace = deps.sessionWorkspaces.get(args.session_id);

          const result = args.mode === 'force'
            ? skipToPhase(args.session_id, args.to_phase)
            : transitionPhase(args.session_id, args.to_phase, args.reason ?? 'captain_manual', workspace);

          if (!result) {
            let validPhases: string[] = [];
            try {
              const wfConfig = loadWorkflow(currentState.workflowName);
              validPhases = wfConfig.phases.map(p => p.name);
            } catch {
              // Workflow config unavailable, leave validPhases empty
            }
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Cannot transition from '${currentState.phase}' to '${args.to_phase}'. Current workflow: ${currentState.workflowName}`,
                  current_phase: currentState.phase,
                  valid_phases: validPhases,
                }),
              }],
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                session_id: args.session_id,
                previous_phase: currentState.phase,
                current_phase: result.phase,
                workflow: result.workflowName,
              }),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: String(error),
              }),
            }],
          };
        }
      }
    ),

    // request_user_input - Send interactive message and wait for response
    tool(
      "request_user_input",
      "Send an interactive message to the user and wait for their response. Captain will block until the user responds or the timeout expires. Use for confirmations, option selection, multi-select, or any decision that requires explicit user input.",
      {
        type: z.enum(['confirmation', 'options', 'multi-select']).describe("Message type: confirmation (yes/no style), options (pick from list), or multi-select (pick multiple items)"),
        text: z.string().describe("Message text shown to the user"),
        actions: z.array(z.object({
          id: z.string().describe("Action identifier (max 52 chars)"),
          label: z.string().describe("Button label shown to user (max 64 chars)"),
          style: z.enum(['primary', 'danger', 'default']).optional().describe("Visual style"),
        })).describe("Available actions the user can pick"),
        minSelections: z.number().optional().describe("For multi-select: minimum number of selections required (default: 1)"),
        maxSelections: z.number().optional().describe("For multi-select: maximum number of selections allowed (optional)"),
        timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 120000)"),
      },
      async (args) => {
        const { type, text, actions, minSelections, maxSelections, timeoutMs = 120_000 } = args;
        const messageId = randomUUID();
        const createdAt = Date.now();
        const expiresAt = createdAt + timeoutMs;

        const interactiveActions = actions.map((a) => ({
          id: a.id,
          label: a.label,
          style: (a.style ?? 'default') as ActionStyle,
        }));

        const message: InteractiveMessage = type === 'multi-select'
          ? {
              id: messageId,
              type: 'multi-select',
              text,
              actions: interactiveActions,
              responseState: 'pending',
              minSelections: minSelections ?? 1,
              maxSelections,
              timeoutMs,
              createdAt,
              expiresAt,
            }
          : {
              id: messageId,
              type,
              text,
              actions: interactiveActions,
              responseState: 'pending',
              timeoutMs,
              createdAt,
              expiresAt,
            };

        return new Promise<InteractiveResponse>((resolve) => {
          const timer = setTimeout(() => {
            captain.respondToInteractiveMessage(messageId, {
              messageId,
              actionId: '__expired__',
              respondedAt: Date.now(),
              source: 'api',
            });
          }, timeoutMs);

          captain.registerPendingInteractiveMessage(messageId, {
            message,
            resolve,
            timer
          });
          captain.emitInteractiveMessage(message);
        }).then((response) => {
          // For multi-select, split comma-separated actionId back to array
          const isMultiSelect = type === 'multi-select';
          const actionIds = isMultiSelect && response.actionId !== '__expired__'
            ? response.actionId.split(',')
            : undefined;

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                message_id: messageId,
                action_id: isMultiSelect ? undefined : response.actionId,
                action_ids: actionIds,
                action_value: response.actionValue,
                expired: response.actionId === '__expired__',
              }),
            }],
          };
        });
      }
    ),

    // get_session_diff - Get git diff for a session's workspace
    tool(
      "get_session_diff",
      "Get the git diff for a session's workspace. Detects if the workspace is a worktree (compares to main/master) or regular repo (compares to HEAD~1). Returns the diff truncated to 10,000 characters if needed.",
      {
        session_id: z.string().describe("The session ID to query"),
      },
      async (args) => {
        try {
          // Get workspace from sessionWorkspaces map
          let workspace = deps.sessionWorkspaces.get(args.session_id);

          // Fallback to fleet monitor
          if (!workspace) {
            const sessionDetail = fleetMonitor.getSessionDetail(args.session_id);
            if (sessionDetail) {
              workspace = sessionDetail.workspace;
            }
          }

          // Fallback to database
          if (!workspace) {
            const messages = deps.database.getConversationHistory(args.session_id, 1);
            if (messages.length > 0) {
              const toolEvents = deps.database.getToolEvents(args.session_id, 1);
              if (toolEvents.length > 0) {
                // Try to extract workspace from tool events (not reliable, but last resort)
                return {
                  content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                      error: "Session not found or workspace unavailable",
                    }),
                  }],
                };
              }
            }
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  error: "Session not found",
                }),
              }],
            };
          }

          // Check if it's a git repository
          try {
            execFileSync('git', ['rev-parse', '--git-dir'], {
              cwd: workspace,
              maxBuffer: 10 * 1024 * 1024,
              encoding: 'utf8',
              stdio: 'pipe',
            });
          } catch {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  error: "Workspace is not a git repository",
                  workspace,
                }),
              }],
            };
          }

          // Detect if it's a worktree
          let isWorktree = false;
          try {
            const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
              cwd: workspace,
              maxBuffer: 10 * 1024 * 1024,
              encoding: 'utf8',
              stdio: 'pipe',
            }).trim();
            const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
              cwd: workspace,
              maxBuffer: 10 * 1024 * 1024,
              encoding: 'utf8',
              stdio: 'pipe',
            }).trim();
            isWorktree = commonDir !== gitDir;
          } catch {
            // If detection fails, assume not a worktree
            isWorktree = false;
          }

          // Get diff based on worktree status
          let diff = '';
          try {
            if (isWorktree) {
              // Try main first, then master, then HEAD
              try {
                diff = execFileSync('git', ['diff', 'main'], {
                  cwd: workspace,
                  maxBuffer: 10 * 1024 * 1024,
                  encoding: 'utf8',
                  stdio: 'pipe',
                });
              } catch {
                try {
                  diff = execFileSync('git', ['diff', 'master'], {
                    cwd: workspace,
                    maxBuffer: 10 * 1024 * 1024,
                    encoding: 'utf8',
                    stdio: 'pipe',
                  });
                } catch {
                  diff = execFileSync('git', ['diff', 'HEAD'], {
                    cwd: workspace,
                    maxBuffer: 10 * 1024 * 1024,
                    encoding: 'utf8',
                    stdio: 'pipe',
                  });
                }
              }
            } else {
              // Regular repo: try HEAD~1, then HEAD
              try {
                diff = execFileSync('git', ['diff', 'HEAD~1'], {
                  cwd: workspace,
                  maxBuffer: 10 * 1024 * 1024,
                  encoding: 'utf8',
                  stdio: 'pipe',
                });
              } catch {
                diff = execFileSync('git', ['diff', 'HEAD'], {
                  cwd: workspace,
                  maxBuffer: 10 * 1024 * 1024,
                  encoding: 'utf8',
                  stdio: 'pipe',
                });
              }
            }
          } catch (error) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  error: `Git diff failed: ${String(error)}`,
                  workspace,
                }),
              }],
            };
          }

          // Truncate to 10,000 chars if needed
          const totalLength = diff.length;
          const truncated = totalLength > 10000;
          const displayDiff = truncated ? diff.slice(0, 10000) + '\n\n[... truncated ...]' : diff;

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                session_id: args.session_id,
                workspace,
                is_worktree: isWorktree,
                diff: displayDiff,
                truncated,
                total_length: totalLength,
              }),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: `Failed to get session diff: ${String(error)}`,
              }),
            }],
          };
        }
      }
    ),

    // get_session_cost - Get estimated cost for a session
    tool(
      "get_session_cost",
      "Get estimated cost for a session based on token usage. Uses Sonnet pricing by default ($3/MTok input, $15/MTok output).",
      {
        session_id: z.string().describe("The session ID to query"),
      },
      async (args) => {
        try {
          const sessionDetail = fleetMonitor.getSessionDetail(args.session_id);
          if (!sessionDetail) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  error: "Session not found",
                }),
              }],
            };
          }

          const inputTokens = sessionDetail.inputTokens;
          const outputTokens = sessionDetail.outputTokens;
          const durationMs = sessionDetail.durationMs;

          // Use Sonnet pricing as default
          const pricing = MODEL_PRICING.sonnet;
          const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
          const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;
          const estimatedCostUsd = inputCost + outputCost;

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                session_id: args.session_id,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                estimated_cost_usd: parseFloat(estimatedCostUsd.toFixed(4)),
                model: 'sonnet',
                duration_ms: durationMs,
                cost_breakdown: {
                  input_cost_usd: parseFloat(inputCost.toFixed(4)),
                  output_cost_usd: parseFloat(outputCost.toFixed(4)),
                },
                pricing_note: `Using Sonnet pricing: $${pricing.inputPerMTok}/MTok input, $${pricing.outputPerMTok}/MTok output`,
              }),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: `Failed to get session cost: ${String(error)}`,
              }),
            }],
          };
        }
      }
    ),

    // check_file_overlaps - Check for file conflicts with running sessions
    tool(
      "check_file_overlaps",
      "Check if specific files are currently being modified by any running session. Use before starting a session to avoid merge conflicts.",
      {
        files: z.array(z.string()).describe("List of file paths (relative to workspace) to check for overlaps"),
        exclude_session_id: z.string().optional().describe("Session ID to exclude from the check (typically the caller's own session)"),
      },
      async (args) => {
        try {
          const overlaps = fleetMonitor.getFileOverlaps(args.files, args.exclude_session_id);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                has_overlaps: overlaps.length > 0,
                overlaps: overlaps.map(o => ({
                  session_id: o.sessionId,
                  overlapping_files: o.overlappingFiles,
                })),
                warning: overlaps.length > 0
                  ? `WARNING: ${overlaps.length} running session(s) are touching the same files. Starting a new session on these files risks merge conflicts.`
                  : null,
              }),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: String(error) }),
            }],
          };
        }
      }
    ),

    // read_file - Read a file's contents with line numbers
    tool(
      "read_file",
      "Read a file's contents with line numbers. Max 500 lines.",
      {
        path: z.string().describe("Absolute file path"),
        offset: z.number().optional().describe("Start line (1-based, default 1)"),
        limit: z.number().optional().describe("Max lines (default 200, max 500)"),
      },
      async (args) => {
        try {
          const stat = statSync(args.path);
          if (stat.isDirectory()) throw new Error("Path is a directory");
          const content = readFileSync(args.path, 'utf8');
          const lines = content.split('\n');
          const start = Math.max(0, (args.offset ?? 1) - 1);
          const end = Math.min(lines.length, start + Math.min(args.limit ?? 200, 500));
          const numbered = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
          return { content: [{ type: "text" as const, text: JSON.stringify({ path: args.path, total_lines: lines.length, showing: `${start+1}-${end}`, content: numbered }) }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(error) }) }] };
        }
      }
    ),

    // grep - Search file contents with regex
    tool(
      "grep",
      "Search file contents with regex. Uses ripgrep.",
      {
        pattern: z.string().describe("Regex pattern"),
        path: z.string().optional().describe("Directory to search (default: workspace)"),
        glob: z.string().optional().describe("File glob filter, e.g. '*.ts'"),
        max_results: z.number().optional().describe("Max results (default 20, max 50)"),
      },
      async (args) => {
        try {
          const searchPath = args.path ?? deps.sessionWorkspaces.values().next().value ?? '.';
          const rgArgs = [args.pattern, searchPath, '-n', '--max-count', String(Math.min(args.max_results ?? 20, 50))];
          if (args.glob) rgArgs.push('--glob', args.glob);
          const result = execFileSync('rg', rgArgs, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024, timeout: 10000 }).slice(0, 10000);
          return { content: [{ type: "text" as const, text: result || 'No matches found' }] };
        } catch (error: any) {
          if (error.status === 1) return { content: [{ type: "text" as const, text: 'No matches found' }] };
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(error) }) }] };
        }
      }
    ),

    // glob_files - Find files matching a glob pattern
    tool(
      "glob_files",
      "Find files matching a glob pattern.",
      {
        pattern: z.string().describe("Glob pattern, e.g. '**/*.ts'"),
        path: z.string().optional().describe("Base directory (default: workspace)"),
      },
      async (args) => {
        try {
          const searchPath = args.path ?? deps.sessionWorkspaces.values().next().value ?? '.';
          const result = execFileSync('rg', ['--files', '--glob', args.pattern, searchPath], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024, timeout: 10000 });
          const files = result.trim().split('\n').filter(Boolean).slice(0, 100);
          return { content: [{ type: "text" as const, text: JSON.stringify({ count: files.length, files }) }] };
        } catch (error: any) {
          if (error.status === 1) return { content: [{ type: "text" as const, text: JSON.stringify({ count: 0, files: [] }) }] };
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(error) }) }] };
        }
      }
    ),

    // git_status - Get git status and current branch
    tool(
      "git_status",
      "Get git status and current branch for a workspace.",
      {
        workspace: z.string().optional().describe("Workspace path (default: first known workspace)"),
      },
      async (args) => {
        try {
          const cwd = args.workspace ?? deps.sessionWorkspaces.values().next().value ?? '.';
          const branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
          const status = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
          const lines = status ? status.split('\n') : [];
          return { content: [{ type: "text" as const, text: JSON.stringify({ branch, clean: lines.length === 0, files: lines.slice(0, 50) }) }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(error) }) }] };
        }
      }
    ),

    // git_log - Get recent git commits
    tool(
      "git_log",
      "Get recent git commits.",
      {
        workspace: z.string().optional().describe("Workspace path"),
        limit: z.number().optional().describe("Max commits (default 10, max 50)"),
        since: z.string().optional().describe("Date filter, e.g. '2 days ago'"),
      },
      async (args) => {
        try {
          const cwd = args.workspace ?? deps.sessionWorkspaces.values().next().value ?? '.';
          const n = Math.min(args.limit ?? 10, 50);
          const gitArgs = ['log', `--format=%H|%an|%ai|%s`, `-n${n}`];
          if (args.since) gitArgs.push('--since', args.since);
          const result = execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
          const commits = result ? result.split('\n').map(line => { const [hash, author, date, ...msg] = line.split('|'); return { hash: hash.slice(0,8), author, date, message: msg.join('|') }; }) : [];
          return { content: [{ type: "text" as const, text: JSON.stringify({ count: commits.length, commits }) }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(error) }) }] };
        }
      }
    ),

    // send_message_to_session - Inject a message into a running session
    tool(
      "send_message_to_session",
      "Send a message to a running session to guide, correct, or nudge it. If the session has an active query, the message is injected immediately with high priority. If idle, it starts a new query (like resume).",
      {
        session_id: z.string().describe("The session ID to send the message to"),
        message: z.string().describe("The message to send to the session"),
      },
      async (args) => {
        try {
          const sessionDetail = fleetMonitor.getSessionDetail(args.session_id);
          if (!sessionDetail) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Session not found" }) }] };
          }

          if (deps.sdkSession.isActive(args.session_id)) {
            // Inject into active query
            const injected = await deps.sdkSession.injectMessage(args.session_id, args.message);
            if (injected) {
              return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, session_id: args.session_id, method: "injected", message: "Message injected into active query" }) }] };
            }
            // Injection failed (query ended between check and inject), fall through to submitQuery
          }

          // Session is idle or injection failed — start new query
          const callbacks = deps.buildSocketCallbacks(args.session_id, sessionDetail.workspace) as any;
          deps.sdkSession.submitQuery(
            args.session_id,
            args.message,
            sessionDetail.workspace,
            callbacks
          );
          fleetMonitor.updateSessionStatus(args.session_id, 'running');

          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, session_id: args.session_id, method: "new_query", message: "New query started with message" }) }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(error) }) }] };
        }
      }
    ),

    // sleep - Suppress proactive tick checks
    tool(
      "sleep",
      "Suppress proactive tick checks for a number of intervals. Use when there's nothing to monitor. Default interval is 60s, so sleep(5) = ~5 minutes of quiet.",
      {
        duration_ticks: z.number().int().min(1).max(60).default(5)
          .describe("Number of tick intervals to sleep (1-60). Default 5 (~5min)."),
      },
      async (args) => {
        try {
          const duration = args.duration_ticks ?? 5;
          const result = sleepTicks(duration);
          const remaining = getSleepRemaining();
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                sleep_ticks: duration,
                sleep_until_tick: result.sleepUntilTick,
                remaining_ticks: remaining,
              }),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: String(error),
              }),
            }],
          };
        }
      }
    ),

    // deploy_ccplus - Deploy ccplus changes
    tool(
      "deploy_ccplus",
      "Deploy ccplus changes. Modes: 'frontend' (build+deploy, no restart), 'backend' (build only, no restart), 'restart' (build backend + restart server — Captain will die and resume on boot).",
      {
        mode: z.enum(['frontend', 'backend', 'restart']).describe("Deploy mode"),
      },
      async (args) => {
        try {
          const ccplusDir = deps.sessionWorkspaces.values().next().value ?? PROJECT_ROOT;

          if (args.mode === 'frontend') {
            const output = execFileSync('./ccplus', ['frontend'], {
              cwd: ccplusDir, encoding: 'utf8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024, timeout: 120000
            });
            return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, mode: 'frontend', message: "Frontend built and deployed. Hard refresh browser to see changes.", output: output.slice(-500) }) }] };
          }

          if (args.mode === 'backend') {
            const output = execFileSync('npm', ['run', 'build'], {
              cwd: `${ccplusDir}/backend-ts`, encoding: 'utf8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024, timeout: 120000
            });
            return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, mode: 'backend', message: "Backend built. Run deploy_ccplus with mode='restart' to apply changes.", output: output.slice(-500) }) }] };
          }

          if (args.mode === 'restart') {
            execFileSync('npm', ['run', 'build'], {
              cwd: `${ccplusDir}/backend-ts`, encoding: 'utf8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024, timeout: 120000
            });

            saveDeployState({ mode: 'restart', savedAt: Date.now() }, DEPLOY_STATE_PATH);

            const child = spawn('bash', ['-c', `sleep 2 && ${ccplusDir}/ccplus restart`], {
              cwd: ccplusDir,
              detached: true,
              stdio: 'ignore',
            });
            child.unref();

            return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, mode: 'restart', message: "Backend built. Server will restart in ~2 seconds. Captain will resume automatically on boot with full conversation history." }) }] };
          }

          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown mode" }) }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(error) }) }] };
        }
      }
    ),

    // memory_update - Replace specific text in a core memory block
    tool(
      'memory_update',
      'Replace specific text in a core memory block. Use this for precise edits — like updating a preference or changing a project detail. The old_content must appear exactly once in the block.',
      {
        label: z.enum(['user', 'project', 'lessons']).describe('Which memory block to edit'),
        old_content: z.string().describe('The exact text to find and replace'),
        new_content: z.string().describe('The replacement text'),
      },
      async ({ label, old_content, new_content }) => {
        const result = updateCoreMemoryBlock(label, old_content, new_content);
        if (!result.success) {
          return `Error: ${result.error}`;
        }
        invalidatePromptCache();
        return `Updated "${label}" block. ${renderBlockStatus(result.block, label)}`;
      }
    ),

    // memory_append - Append text to a core memory block
    tool(
      'memory_append',
      'Append text to a core memory block. Use this to add new information without modifying existing content.',
      {
        label: z.enum(['user', 'project', 'lessons']).describe('Which memory block to append to'),
        content: z.string().describe('Text to append (will be added on a new line)'),
      },
      async ({ label, content }) => {
        const result = appendCoreMemory(label, content);
        if (!result.success) {
          return `Error: ${result.error}`;
        }
        invalidatePromptCache();
        return `Appended to "${label}" block. ${renderBlockStatus(result.block, label)}`;
      }
    ),

    // memory_rethink - Wholesale replacement of a core memory block
    tool(
      'memory_rethink',
      'Replace the entire content of a core memory block. Use this when the block needs reorganization or has become cluttered. Write a complete, coherent replacement that integrates old and new information.',
      {
        label: z.enum(['user', 'project', 'lessons']).describe('Which memory block to rewrite'),
        content: z.string().describe('The complete new content for the block'),
      },
      async ({ label, content }) => {
        const result = rethinkCoreMemory(label, content);
        if (!result.success) {
          return `Error: ${result.error}`;
        }
        invalidatePromptCache();
        return `Rewrote "${label}" block. ${renderBlockStatus(result.block, label)}`;
      }
    ),
  ];
}

// ---- Memory Tool Helpers ----

function renderBlockStatus(block: CoreMemoryBlock, label: string): string {
  const content = block[label as keyof CoreMemoryBlock] as string;
  return `[${content.length} chars used]`;
}
