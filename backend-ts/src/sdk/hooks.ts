import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import { sessions } from "./session-manager.js";
import * as database from "../database.js";
import { log } from "../logger.js";
import * as config from "../config.js";
import { evaluatePreToolUse, getPhaseContext, getWorkflowState, inferPhaseFromAgent, transitionPhase } from '../workflow-state.js';
import { WORKFLOW_ENABLED } from '../config.js';
import * as fleetMonitor from '../fleet-monitor.js';
import { searchMemories } from '../memory-client.js';

export function safeParams(params: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "tool_use_id") continue;
    if (typeof v === "string" && v.length > 200) {
      cleaned[k] = v.slice(0, 200) + "...";
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

export function buildHooks(sessionId: string): Record<string, HookCallbackMatcher[]> {
  const toolTimers = new Map<string, number>();
  const agentIdToToolUseId = new Map<string, string>();
  const agentStopData = new Map<string, { transcriptPath?: string; lastMessage?: string }>();
  const pendingAgentToolUseIds: string[] = [];
  const detectedDevServerUrls = new Set<string>();

  // Helper to emit tool events and set flag for message splitting
  const emitToolEvent = (event: any) => {
    const session = sessions.get(sessionId);
    if (session?.callbacks) {
      session.callbacks.onToolEvent(event);
      // Mark that a tool event occurred so subsequent text gets a new message bubble
      session.hadToolSinceLastText = true;
    }
  };

  const preToolUse: HookCallback = async (hookInput, toolUseId) => {
    const input = hookInput as Record<string, unknown>;
    const toolName = (input.tool_name as string) ?? "unknown";
    const actualToolUseId = toolUseId ?? (input.tool_use_id as string) ?? `tu_${Date.now()}`;
    const toolParams = (input.tool_input as Record<string, unknown>) ?? {};

    toolTimers.set(actualToolUseId, performance.now());

    const parentId = input.agent_id as string | undefined;
    const isAgent = toolName === "Agent" || toolName === "Task";

    const session = sessions.get(sessionId);
    if (!session?.callbacks) return {};

    const agentDescription = isAgent
      ? ((toolParams.description as string) ?? ((toolParams.prompt as string) ?? "").slice(0, 100))
      : undefined;

    if (isAgent) {
      pendingAgentToolUseIds.push(actualToolUseId);
      emitToolEvent({
        type: "agent_start",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ?? null,
        agent_type: (toolParams.subagent_type as string) ?? "agent",
        description: agentDescription,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      });
    } else {
      emitToolEvent({
        type: "tool_start",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ? (agentIdToToolUseId.get(parentId) ?? parentId) : null,
        parameters: safeParams(toolParams),
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      });

      // Emit dedicated todo_update for TodoWrite tools
      if (toolName === 'TodoWrite') {
        const todos = toolParams.todos as Array<{ content: string; status: string; activeForm: string }> | undefined;
        if (todos) {
          // Store latest todos in session state
          session.latestTodos = todos;

          emitToolEvent({
            type: 'todo_update',
            tool_name: 'TodoWrite',
            tool_use_id: actualToolUseId,
            parent_agent_id: parentId ? (agentIdToToolUseId.get(parentId) ?? parentId) : null,
            parameters: { todos },
            timestamp: new Date().toISOString(),
            session_id: sessionId,
          });
        }
      }
    }

    // Record to database (success=null means "running")
    try {
      database.recordToolEvent(
        sessionId,
        toolName,
        actualToolUseId,
        isAgent ? undefined : (parentId ? (agentIdToToolUseId.get(parentId) ?? parentId) : undefined),
        isAgent ? ((toolParams.subagent_type as string) ?? undefined) : undefined,
        null, // success = running
        null,
        null,
        isAgent ? undefined : JSON.stringify(safeParams(toolParams)),
        null,
        null,
        agentDescription,
      );
    } catch (e) {
      log.error("Database write failed (preToolUse)", { sessionId, toolName, toolUseId: actualToolUseId, error: String(e) });
    }

    // Update fleet monitor
    fleetMonitor.incrementToolCount(sessionId);
    if (isAgent) {
      fleetMonitor.incrementAgentCount(sessionId);
    }

    // Workflow phase enforcement
    if (WORKFLOW_ENABLED) {
      const wfState = getWorkflowState(sessionId);
      const enforcement = evaluatePreToolUse(wfState.phase, toolName, (input.tool_input as Record<string, unknown>) ?? {});
      if (enforcement.action === 'block') {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'deny' as const,
            permissionDecisionReason: enforcement.message ?? 'Blocked by workflow phase',
          },
        };
      }
      if (enforcement.action === 'warn') {
        const session = sessions.get(sessionId);
        if (session?.callbacks) {
          session.callbacks.onSignal?.({
            type: 'workflow_warning',
            data: { message: enforcement.message, phase: wfState.phase },
          });
        }
      }
    }

    return { continue: true };
  };

  const postToolUse: HookCallback = async (hookInput, toolUseId) => {
    const input = hookInput as Record<string, unknown>;
    const toolName = (input.tool_name as string) ?? "unknown";
    const actualToolUseId = toolUseId ?? (input.tool_use_id as string) ?? "";
    const toolParams = (input.tool_input as Record<string, unknown>) ?? {};

    const start = toolTimers.get(actualToolUseId);
    toolTimers.delete(actualToolUseId);
    const durationMs = start !== undefined ? performance.now() - start : null;

    const isAgent = toolName === "Agent" || toolName === "Task";
    const parentId = input.agent_id as string | undefined;

    const session = sessions.get(sessionId);
    if (!session?.callbacks) return {};

    if (isAgent) {
      const stopData = agentStopData.get(actualToolUseId);
      emitToolEvent({
        type: "agent_stop",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        success: true,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        transcript_path: stopData?.transcriptPath ?? null,
        summary: stopData?.lastMessage ?? null,
      });

      // Decrement fleet monitor agent count
      fleetMonitor.decrementAgentCount(sessionId);

      // Clean up agent_id mapping and stop data
      for (const [agentId, tuId] of agentIdToToolUseId.entries()) {
        if (tuId === actualToolUseId) {
          agentIdToToolUseId.delete(agentId);
          break;
        }
      }
      agentStopData.delete(actualToolUseId);

      // Update database with summary
      try {
        database.updateToolEvent(sessionId, actualToolUseId, true, null, durationMs, stopData?.lastMessage ?? null);
      } catch (e) {
        log.error("Database write failed (postToolUse agent)", { sessionId, toolName, toolUseId: actualToolUseId, error: String(e) });
      }
    } else {
      const event: Record<string, unknown> = {
        type: "tool_complete",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ? (agentIdToToolUseId.get(parentId) ?? parentId) : null,
        success: true,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      };

      // Include content params for Write/Edit tools for LOC counting
      if (toolName === "Write" || toolName === "Edit") {
        const locParams: Record<string, unknown> = {};
        if ("content" in toolParams) locParams.content = toolParams.content;
        if ("new_string" in toolParams) locParams.new_string = toolParams.new_string;
        if (Object.keys(locParams).length > 0) event.parameters = locParams;

        // Track file modifications in fleet monitor
        const filePath = toolParams.file_path as string | undefined;
        if (filePath) {
          fleetMonitor.addFileTouched(sessionId, filePath);
        }
      }

      emitToolEvent(event);

      // Update database (tools only, agents updated above)
      try {
        database.updateToolEvent(sessionId, actualToolUseId, true, null, durationMs);
      } catch (e) {
        log.error("Database write failed (postToolUse tool)", { sessionId, toolName, toolUseId: actualToolUseId, error: String(e) });
      }

      // Detect dev server URLs from Bash tool output
      if (toolName === "Bash") {
        const toolResponse = input.tool_response;
        let responseText = "";

        // Convert tool_response to string
        if (typeof toolResponse === "string") {
          responseText = toolResponse;
        } else if (toolResponse && typeof toolResponse === "object") {
          try {
            responseText = JSON.stringify(toolResponse);
          } catch {
            responseText = String(toolResponse);
          }
        }

        if (responseText) {
          // Regex patterns for dev server URLs
          const urlPatterns = [
            /(?:Local|listening on|ready on|started at|running at|server running on)[:\s]+(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/gi,
            /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/g,
          ];

          for (const pattern of urlPatterns) {
            const matches = responseText.matchAll(pattern);
            for (const match of matches) {
              let url = match[0];

              // Extract just the URL part if it's in a sentence
              const urlMatch = url.match(/https?:\/\/[^\s]+/);
              if (urlMatch) {
                url = urlMatch[0];
              } else {
                // Add http:// if missing
                const hostMatch = url.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/);
                if (hostMatch) {
                  url = `http://${hostMatch[0]}`;
                }
              }

              // Clean trailing punctuation
              url = url.replace(/[,;.]+$/, "");

              // Emit if new
              if (url && !detectedDevServerUrls.has(url)) {
                detectedDevServerUrls.add(url);
                session.callbacks.onDevServerDetected?.(url);
                log.debug("Dev server URL detected", { sessionId, url, toolUseId: actualToolUseId });
              }
            }
          }
        }
      }
    }

    return {};
  };

  const postToolUseFailure: HookCallback = async (hookInput, toolUseId) => {
    const input = hookInput as Record<string, unknown>;
    const toolName = (input.tool_name as string) ?? "unknown";
    const actualToolUseId = toolUseId ?? (input.tool_use_id as string) ?? "";
    const errorMsg = String(input.error ?? "Unknown error");

    const start = toolTimers.get(actualToolUseId);
    toolTimers.delete(actualToolUseId);
    const durationMs = start !== undefined ? performance.now() - start : null;

    const isAgent = toolName === "Agent" || toolName === "Task";
    const parentId = input.agent_id as string | undefined;

    const session = sessions.get(sessionId);
    if (!session?.callbacks) return {};

    if (isAgent) {
      const stopData = agentStopData.get(actualToolUseId);
      emitToolEvent({
        type: "agent_stop",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        success: false,
        error: errorMsg,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        transcript_path: stopData?.transcriptPath ?? null,
        summary: stopData?.lastMessage ?? null,
      });

      // Decrement fleet monitor agent count
      fleetMonitor.decrementAgentCount(sessionId);

      // Clean up agent_id mapping and stop data
      for (const [agentId, tuId] of agentIdToToolUseId.entries()) {
        if (tuId === actualToolUseId) {
          agentIdToToolUseId.delete(agentId);
          break;
        }
      }
      agentStopData.delete(actualToolUseId);

      // Update database with summary (for failed agents)
      try {
        database.updateToolEvent(sessionId, actualToolUseId, false, errorMsg, durationMs, stopData?.lastMessage ?? null);
      } catch (e) {
        log.error("Database write failed (postToolUseFailure agent)", { sessionId, toolName, toolUseId: actualToolUseId, error: String(e) });
      }
    } else {
      emitToolEvent({
        type: "tool_complete",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ? (agentIdToToolUseId.get(parentId) ?? parentId) : null,
        success: false,
        error: errorMsg,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      });

      // Update database (tools only, agents updated above)
      try {
        database.updateToolEvent(sessionId, actualToolUseId, false, errorMsg, durationMs);
      } catch (e) {
        log.error("Database write failed (postToolUseFailure tool)", { sessionId, toolName, toolUseId: actualToolUseId, error: String(e) });
      }
    }

    return {};
  };

  const subagentStart: HookCallback = async (hookInput) => {
    const input = hookInput as Record<string, unknown>;
    const agentId = input.agent_id as string;
    if (agentId && pendingAgentToolUseIds.length > 0) {
      const toolUseIdForAgent = pendingAgentToolUseIds.pop()!;
      agentIdToToolUseId.set(agentId, toolUseIdForAgent);
    }

    // Auto-transition workflow phase based on agent type
    if (WORKFLOW_ENABLED) {
      const agentType = (input as { agent_type?: string }).agent_type ?? '';
      const inferredPhase = inferPhaseFromAgent(agentType);
      log.info('Workflow: SubagentStart', { sessionId, agentType, inferredPhase: inferredPhase ?? 'none' });
      if (inferredPhase) {
        const currentState = getWorkflowState(sessionId);
        if (currentState.phase !== inferredPhase) {
          const newState = transitionPhase(sessionId, inferredPhase, `agent:${agentType}`);
          if (newState) {
            const session = sessions.get(sessionId);
            if (session?.callbacks) {
              session.callbacks.onSignal?.({
                type: 'workflow_phase',
                data: {
                  phase: newState.phase,
                  previous: currentState.phase,
                  sessionId,
                },
              });
            }
          }
        }
      }
    }

    // Build additional context (workflow + memory)
    let workflowContext = '';
    if (WORKFLOW_ENABLED) {
      const phaseCtx = getPhaseContext(getWorkflowState(sessionId).phase);
      if (phaseCtx) workflowContext = phaseCtx + '\n\n';
    }

    let memoryContext = '';
    if (config.MEMORY_ENABLED) {
      try {
        const session = sessions.get(sessionId);
        const toolInput = input.tool_input as Record<string, unknown> | undefined;
        const description = (toolInput?.description as string) ?? '';
        const prompt = (toolInput?.prompt as string) ?? '';
        const searchQuery = (description + ' ' + prompt).trim(); // Use full prompt for better retrieval

        if (searchQuery.length > 10) {
          const projectName = session?.workspace ? path.basename(session.workspace) : '';
          const agentType = (input as { agent_type?: string }).agent_type ?? '';

          const timeoutPromise = new Promise<string>(resolve =>
            setTimeout(() => resolve(''), config.MEMORY_HOOK_TIMEOUT_MS)
          );

          // Search agent-specific memories first, then project-wide
          const searchPromises: Promise<string>[] = [];

          // 1. Agent-specific memories (if agent type is known)
          if (agentType && projectName) {
            const agentTag = `project:${projectName},agent:${agentType}`;
            searchPromises.push(
              searchMemories(searchQuery, 2, agentTag).catch(() => '')
            );
          }

          // 2. Project-wide memories
          if (projectName) {
            const projectTag = `project:${projectName}`;
            searchPromises.push(
              searchMemories(searchQuery, 3, projectTag).catch(() => '')
            );
          }

          // Wait for all searches with timeout
          const results = await Promise.race([
            Promise.all(searchPromises),
            timeoutPromise.then(() => []),
          ]);

          // Combine results - agent-specific first, then project-wide
          const combinedMemories = results.filter(r => r.length > 0).join('\n\n---\n\n');
          if (combinedMemories) {
            const agentSpecificCount = results[0]?.split('\n').filter(l => l.trim()).length || 0;
            const projectCount = results[1]?.split('\n').filter(l => l.trim()).length || 0;

            log.debug('Memory injection for subagent', {
              agentType,
              agentSpecificCount,
              projectCount,
            });

            memoryContext = `## Prior Knowledge\n${combinedMemories}`;
          }
        }
      } catch (error) {
        log.warn('Memory injection into subagent failed', { error: String(error) });
      }
    }

    // Return combined context if we have any
    const combinedContext = workflowContext + memoryContext;
    if (combinedContext) {
      return {
        hookSpecificOutput: {
          hookEventName: 'SubagentStart' as const,
          additionalContext: combinedContext,
        },
      };
    }

    return {};
  };

  const subagentStop: HookCallback = async (hookInput) => {
    const input = hookInput as Record<string, unknown>;
    const agentId = input.agent_id as string;
    if (agentId) {
      const toolUseId = agentIdToToolUseId.get(agentId);
      if (toolUseId) {
        agentStopData.set(toolUseId, {
          transcriptPath: input.agent_transcript_path as string | undefined,
          lastMessage: input.last_assistant_message as string | undefined,
        });

        // Store agent-specific memory with agent namespace tag
        if (config.MEMORY_DISTILL_ENABLED) {
          const agentType = (input.agent_type as string) ?? 'agent';
          const lastMessage = input.last_assistant_message as string | undefined;
          const toolInput = input.tool_input as Record<string, unknown> | undefined;
          const taskDescription = (toolInput?.description as string) ?? (toolInput?.prompt as string) ?? '';

          // Only store if we have meaningful content
          if (lastMessage && lastMessage.length > 50 && taskDescription.length > 10) {
            const session = sessions.get(sessionId);
            const projectName = session?.workspace ? path.basename(session.workspace) : '';

            if (projectName) {
              const agentMemory = [
                `Agent: ${agentType}`,
                `Task: ${taskDescription.substring(0, 200)}`,
                `Outcome: ${lastMessage.substring(0, 300)}`,
              ].join('\n');

              // Fire and forget - don't block on memory storage
              import('../memory-client.js').then(({ storeMemory }) => {
                storeMemory(
                  agentMemory,
                  [
                    `project:${projectName}`,
                    `agent:${agentType}`,
                    `session:${sessionId}`,
                    'type:agent-lesson',
                    'auto-distill',
                  ].join(','),
                  {
                    session_id: sessionId,
                    agent_id: agentId,
                    agent_type: agentType,
                  }
                ).catch(error => {
                  log.debug('Agent memory storage failed', { error: String(error), agentType });
                });
              }).catch(() => {
                // Ignore import errors
              });
            }
          }
        }
      }
    }

    return {};
  };

  return {
    PreToolUse: [{ hooks: [preToolUse] }],
    PostToolUse: [{ hooks: [postToolUse] }],
    PostToolUseFailure: [{ hooks: [postToolUseFailure] }],
    SubagentStart: [{ hooks: [subagentStart] }],
    SubagentStop: [{ hooks: [subagentStop] }],
  };
}
