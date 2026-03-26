/**
 * captain-tools.ts
 *
 * MCP tool definitions for fleet control.
 * Extracted from captain.ts for modularity and testing.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as fleetMonitor from "./fleet-monitor.js";
import { startSession } from "./session-api.js";
import { getWorkflowState, transitionPhase, skipToPhase } from "./workflow-state.js";
import { loadWorkflow } from "./workflow-config.js";
import { log } from "./logger.js";
import * as captain from "./captain.js";
import type { ActionStyle, InteractiveMessage, InteractiveResponse } from './interactive-message.js';
import { randomUUID } from 'crypto';

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
      "List all active and recent sessions in the fleet with status, tool counts, duration, and workspace information",
      {},
      async () => {
        try {
          const fleetState = fleetMonitor.getFleetState();
          const sessions = fleetState.sessions.map((s: fleetMonitor.EnrichedFleetSessionInfo) => ({
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
            workflow_phase: s.workflowPhase ?? null,
            workflow_name: s.workflowName ?? null,
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
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Failed to list sessions: ${String(error)}`,
                }, null, 2),
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
      },
      async (args) => {
        try {
          const result = startSession(
            {
              prompt: args.prompt,
              workspace: args.workspace,
              sessionId: args.session_id,
              requestedBy: deps.getLastQuerySource() ?? undefined,
              workflow: args.workflow,
            },
            deps
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

    // get_session_detail - Get conversation history and tool events for a session
    tool(
      "get_session_detail",
      "Get detailed conversation history and tool events for a specific session",
      {
        session_id: z.string().describe("The session ID to query"),
      },
      async (args) => {
        try {
          const messages = deps.database.getConversationHistory(args.session_id, 100);
          const toolEvents = deps.database.getToolEvents(args.session_id, 200);

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
                    content: (m.content as string).slice(0, 1500),
                    timestamp: m.timestamp,
                  })),
                  tool_events: toolEvents.map((t) => ({
                    tool_name: t.tool_name,
                    success: t.success,
                    duration_ms: t.duration_ms,
                    timestamp: t.timestamp,
                    agent_type: t.agent_type,
                  })),
                  workflow,
                  fleet,
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
          deps.sdkSession.cancelQuery(args.session_id);
          fleetMonitor.updateSessionStatus(args.session_id, 'cancelled');
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
                  }, null, 2),
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
                  }, null, 2),
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
                  error: `Failed to get fleet stats: ${String(error)}`,
                }, null, 2),
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
                  created_at: workflowState.createdAt,
                  phase_rules: phaseRules,
                },
                fleet: sessionDetail ? {
                  status: sessionDetail.status,
                  workspace: sessionDetail.workspace,
                  tool_count: sessionDetail.toolCount,
                  active_agents: sessionDetail.activeAgents,
                  input_tokens: sessionDetail.inputTokens,
                  output_tokens: sessionDetail.outputTokens,
                  files_touched: sessionDetail.filesTouched,
                  duration_ms: sessionDetail.durationMs,
                  label: sessionDetail.label,
                  started_at: sessionDetail.startedAt,
                  last_activity: sessionDetail.lastActivity,
                } : null,
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: `Failed to get session state: ${String(error)}`,
              }, null, 2),
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

          const result = args.mode === 'force'
            ? skipToPhase(args.session_id, args.to_phase)
            : transitionPhase(args.session_id, args.to_phase, args.reason ?? 'captain_manual');

          if (!result) {
            const validTransitions = ['idle', 'design', 'plan', 'execute', 'test', 'review', 'complete'];
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Cannot transition from '${currentState.phase}' to '${args.to_phase}'. Current workflow: ${currentState.workflowName}`,
                  current_phase: currentState.phase,
                  valid_phases: validTransitions,
                }, null, 2),
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
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: String(error),
              }, null, 2),
            }],
          };
        }
      }
    ),

    // request_user_input - Send interactive message and wait for response
    tool(
      "request_user_input",
      "Send an interactive message to the user and wait for their response. Captain will block until the user responds or the timeout expires. Use for confirmations, option selection, or any decision that requires explicit user input.",
      {
        type: z.enum(['confirmation', 'options']).describe("Message type: confirmation (yes/no style) or options (pick from list)"),
        text: z.string().describe("Message text shown to the user"),
        actions: z.array(z.object({
          id: z.string().describe("Action identifier (max 52 chars)"),
          label: z.string().describe("Button label shown to user (max 64 chars)"),
          style: z.enum(['primary', 'danger', 'default']).optional().describe("Visual style"),
        })).describe("Available actions the user can pick"),
        timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 120000)"),
      },
      async (args) => {
        const { type, text, actions, timeoutMs = 120_000 } = args;
        const messageId = randomUUID();
        const createdAt = Date.now();
        const expiresAt = createdAt + timeoutMs;

        const interactiveActions = actions.map((a) => ({
          id: a.id,
          label: a.label,
          style: (a.style ?? 'default') as ActionStyle,
        }));

        const message: InteractiveMessage = {
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
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                message_id: messageId,
                action_id: response.actionId,
                action_value: response.actionValue,
                expired: response.actionId === '__expired__',
              }, null, 2),
            }],
          };
        });
      }
    ),
  ];
}
