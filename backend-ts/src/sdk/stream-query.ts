import { query, type ModelUsage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readdirSync, copyFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { ActiveSession } from "./types.js";
import { sessions, MAX_STREAMING_BUFFER, getSdkSettingsPath } from "./session-manager.js";
import { buildHooks } from "./hooks.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { buildSignalServer } from "./signal-server.js";
import { getInstalledPlugins } from "./skills.js";
import * as config from "../config.js";
import * as database from "../database.js";
import { getAllMcpServers, buildSdkMcpServers } from "../mcp-config.js";
import { log } from "../logger.js";
import { distillSession } from '../memory-distiller.js';
import * as fleetMonitor from '../fleet-monitor.js';
import * as captain from '../captain.js';
import { getAgent, resolveAgentModel, type ResolvedAgent } from '../agent-config.js';
import { loadWorkflow } from '../workflow-config.js';

// ---- Internal streaming logic ----

const execAsync = promisify(exec);

/**
 * Ensure workspace is checked out to the tip of the local main/master branch before creating a worktree.
 * No remote operations (fetch, pull) are performed.
 * Non-fatal: logs warning and continues if anything fails.
 */
async function ensureWorkspaceUpToDate(workspace: string, sessionId: string): Promise<void> {
  try {
    // Verify this is a git repo
    await execAsync('git rev-parse --git-dir', { cwd: workspace });

    // Detect the default branch (main or master)
    let defaultBranch: string | null = null;
    try {
      await execAsync('git rev-parse --verify main', { cwd: workspace });
      defaultBranch = 'main';
    } catch {
      try {
        await execAsync('git rev-parse --verify master', { cwd: workspace });
        defaultBranch = 'master';
      } catch {
        log.debug('No main or master branch found, skipping workspace sync', { sessionId });
        return;
      }
    }

    // Check if HEAD already points to the tip of the default branch
    const { stdout: headCommit } = await execAsync('git rev-parse HEAD', { cwd: workspace });
    const { stdout: branchCommit } = await execAsync(`git rev-parse ${defaultBranch}`, { cwd: workspace });

    if (headCommit.trim() === branchCommit.trim()) {
      log.debug('Workspace already at tip of local branch, no checkout needed', {
        sessionId,
        branch: defaultBranch
      });
      return;
    }

    // HEAD doesn't match branch tip - check if working tree is clean
    const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: workspace });
    if (statusOut.trim()) {
      log.warn('Workspace has uncommitted changes and is not at tip of local branch. Worktree will be created from stale commit.', {
        sessionId,
        branch: defaultBranch,
        headCommit: headCommit.trim().slice(0, 7),
        branchCommit: branchCommit.trim().slice(0, 7),
      });
      return;
    }

    // Working tree is clean - checkout the local branch tip
    await execAsync(`git checkout ${defaultBranch}`, { cwd: workspace });
    log.info('Workspace checked out to local branch tip', {
      sessionId,
      branch: defaultBranch,
      commit: branchCommit.trim().slice(0, 7),
    });
  } catch (error) {
    log.warn('Failed to sync workspace to local branch before worktree creation (non-fatal)', {
      sessionId,
      error: String(error),
    });
  }
}

/**
 * Copy conversation file from worktree project dir to main project dir.
 * This allows SDK sessions created in worktrees to be resumed from the main workspace.
 */
export function copyWorktreeConversation(sdkSessionId: string, workspace: string): void {
  if (!config.getWorktreeEnabled()) return;

  try {
    // Compute main project dir path
    const mainProjectDirName = workspace.replace(/\//g, '-');
    const mainProjectDir = path.join(homedir(), '.claude', 'projects', mainProjectDirName);
    const targetPath = path.join(mainProjectDir, `${sdkSessionId}.jsonl`);

    // Check if conversation file already exists in main project dir
    if (existsSync(targetPath)) {
      log.debug('Conversation file already exists in main project dir', { sdkSessionId, targetPath });
      return;
    }

    // Search for worktree project dirs matching pattern
    const projectsDir = path.join(homedir(), '.claude', 'projects');
    if (!existsSync(projectsDir)) {
      log.debug('Projects directory does not exist', { projectsDir });
      return;
    }

    const worktreePattern = `${mainProjectDirName}--claude-worktrees-`;
    const projectDirs = readdirSync(projectsDir);

    for (const dirName of projectDirs) {
      if (!dirName.startsWith(worktreePattern)) continue;

      const worktreeConvPath = path.join(projectsDir, dirName, `${sdkSessionId}.jsonl`);
      if (existsSync(worktreeConvPath)) {
        copyFileSync(worktreeConvPath, targetPath);
        log.info('Copied worktree conversation to main project dir', {
          sdkSessionId,
          from: worktreeConvPath,
          to: targetPath,
        });
        return;
      }
    }

    log.debug('No worktree conversation file found for session', { sdkSessionId, pattern: worktreePattern });
  } catch (error) {
    log.error('Failed to copy worktree conversation', { sdkSessionId, error: String(error) });
  }
}

export async function streamQuery(
  session: ActiveSession,
  prompt: string,
  workspace: string,
  model?: string,
  imageIds?: string[],
  agentId?: string,
  workflow?: string,
): Promise<void> {
  const resultText: string[] = [];
  let gotResult = false;
  let assistantMsgId: number | null = null;
  let streamEventsActive = false;
  let lastCompletionData: Record<string, unknown> = {};
  let messageIndex = 0;
  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;

  const { sessionId } = session;
  const callbacks = session.callbacks;
  if (!callbacks) return;

  // Reset streaming content at the start of each query
  session.streamingContent = '';

  // Initialize workflow state if workflow parameter is provided
  if (workflow) {
    const { getWorkflowState } = await import('../workflow-state.js');
    const currentState = getWorkflowState(sessionId, workflow);
    // State is now initialized with the correct workflow and default_phase
    log.debug('Workflow state initialized', { sessionId, workflow, phase: currentState.phase });
  }

  // Load agent config if agentId provided
  let agentConfig: ResolvedAgent | null = null;
  if (agentId) {
    try {
      agentConfig = await getAgent(workspace, agentId);
      if (!agentConfig) {
        log.warn('Agent not found, proceeding without agent config', { sessionId, agentId });
      }
    } catch (err) {
      log.warn('Failed to load agent config, proceeding without it', { sessionId, agentId, error: String(err) });
    }
  }

  try {
    // Look up previous SDK session ID for resume
    const resumeId = database.getLastSdkSessionId(sessionId);
    log.debug("Query started", { sessionId, resume: resumeId ?? 'none', workspace });

    // Build environment with whitelist approach (only pass known-safe env vars)
    // Legacy blacklist: k !== "CLAUDECODE" && k !== "ANTHROPIC_API_KEY"
    const envWhitelist = [
      'PATH', 'HOME', 'SHELL', 'USER', 'LANG', 'TERM', 'NODE_ENV',
      'WORKSPACE_PATH', 'SDK_MODEL', 'PORT', 'CCPLUS_AUTH',
      'TMPDIR', 'TEMP', 'TMP',
      'EDITOR', 'VISUAL', 'PAGER',
      'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES',
      'DISPLAY', 'COLORTERM',
    ];
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && (envWhitelist.includes(k) || k.startsWith('XDG_'))) {
        cleanEnv[k] = v;
      }
    }

    // Build hooks
    const hooks = buildHooks(sessionId, workspace);

    // Settings
    const sdkSettingsPath = getSdkSettingsPath();

    // Build can_use_tool for AskUserQuestion handling
    const canUseTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ): Promise<{ behavior: "allow"; updatedInput?: Record<string, unknown> }> => {
      if (toolName === "AskUserQuestion") {
        const questions = (toolInput.questions as unknown[]) ?? [];
        const toolUseIdLocal = `perm_${Date.now()}`;

        // Store question data
        const questionData = { questions, tool_use_id: toolUseIdLocal };

        // Emit to frontend
        callbacks.onUserQuestion?.({
          questions,
          tool_use_id: toolUseIdLocal,
        });

        // Wait for user response (up to 5 minutes)
        const answers = await new Promise<Record<string, unknown>>((resolve) => {
          session.pendingQuestion = { resolve, data: questionData };
          session.questionTimeout = setTimeout(() => {
            if (session.pendingQuestion) {
              session.pendingQuestion = null;
              session.questionTimeout = null;
              resolve({});
            }
          }, 300_000);
        });

        return {
          behavior: "allow",
          updatedInput: { ...toolInput, answers },
        };
      }

      return { behavior: "allow" };
    };

    // Convert slash commands to regular prompts so the SDK doesn't intercept them.
    // The model handles skills natively via the Skill tool.
    let effectivePrompt = prompt;
    if (prompt.startsWith("/")) {
      const spaceIdx = prompt.indexOf(" ");
      const skillName = spaceIdx > 0 ? prompt.slice(1, spaceIdx) : prompt.slice(1);
      const args = spaceIdx > 0 ? prompt.slice(spaceIdx + 1).trim() : "";
      effectivePrompt = args
        ? `Run the /${skillName} slash command with these arguments: ${args}`
        : `Run the /${skillName} slash command.`;
    }

    // Build query content
    let queryContent: string | AsyncIterable<Record<string, unknown>> = effectivePrompt;

    if (imageIds?.length) {
      const contentBlocks: Record<string, unknown>[] = [];

      for (const imgId of imageIds) {
        try {
          const img = database.getImage(imgId);
          if (img) {
            const data = img.data as Buffer;
            const b64 = data.toString("base64");
            let mediaType = img.mime_type as string;
            if (mediaType === "image/jpg") mediaType = "image/jpeg";

            contentBlocks.push({
              type: "image",
              source: { type: "base64", media_type: mediaType, data: b64 },
            });
          }
        } catch (e) {
          log.error("Failed to load image", { sessionId, imageId: imgId, error: String(e) });
        }
      }

      if (prompt) {
        contentBlocks.push({ type: "text", text: prompt });
      }

      async function* messageStream() {
        yield {
          type: "user",
          message: { role: "user", content: contentBlocks },
        };
      }
      queryContent = messageStream();
    }

    // Load installed plugins so the SDK subprocess can execute skills
    const installedPlugins = getInstalledPlugins();

    // Build signal server for progress reporting
    const signalServer = buildSignalServer(sessionId, callbacks);

    // Load MCP servers from user and project configs
    const mcpServerEntries = getAllMcpServers(workspace);
    const userMcpServers = buildSdkMcpServers(mcpServerEntries);

    // Determine if worktree should be enabled
    let worktreeEnabled = config.getWorktreeEnabled();
    if (workflow) {
      const workflowConfig = loadWorkflow(workflow, workspace);
      if (workflowConfig.worktree !== undefined) {
        worktreeEnabled = workflowConfig.worktree;
      }
    }

    // Ensure workspace is on latest main before SDK creates worktree
    if (worktreeEnabled && !resumeId) {
      await ensureWorkspaceUpToDate(workspace, sessionId);
    }

    // Apply agent model if provided and no explicit model override
    let effectiveModel = model ?? config.getSDKModel();
    if (agentConfig?.model && !model) {
      effectiveModel = resolveAgentModel(agentConfig.model);
    }
    const effectiveMaxTurns = agentConfig?.maxTurns ?? 50;

    const q = query({
      prompt: queryContent as string,
      options: {
        model: effectiveModel,
        cwd: workspace,
        settingSources: ['user', 'project'],
        permissionMode: config.getBypassPermissions() ? "bypassPermissions" as any : undefined,
        allowDangerouslySkipPermissions: config.getBypassPermissions(),
        env: cleanEnv,
        hooks: hooks as any,
        plugins: [
          { type: 'local' as const, path: config.PROJECT_ROOT },
          ...installedPlugins,
        ] as any,
        mcpServers: {
          "ccplus-signals": signalServer,
          ...userMcpServers,
        } as any,
        resume: resumeId ?? undefined,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: await buildSystemPrompt(workspace, prompt, sessionId, agentConfig ?? undefined, workflow),
        } as any,
        canUseTool: canUseTool as any,
        maxTurns: effectiveMaxTurns,
        includePartialMessages: true,
        promptSuggestions: true,
        ...(worktreeEnabled && !resumeId && {
          extraArgs: { worktree: null },
          settings: {
            worktree: {
              symlinkDirectories: ['node_modules'],
            },
          },
        }),
      },
    });

    session.activeQuery = q;

    for await (const message of q) {
      // Check cancellation
      if (session.cancelRequested) {
        await q.interrupt();
        try { q.close(); } catch { /* already closed */ }
        fleetMonitor.updateSessionStatus(sessionId, 'completed');
        break;
      }

      if (message.type === "assistant") {
        messageIndex++;
        const msg = message as any;
        let hasText = false;
        const currentMessageText: string[] = [];

        for (const block of (msg.message?.content ?? [])) {
          if (block.type === "text") {
            if (!streamEventsActive) {
              // If a tool event occurred since the last text, increment messageIndex
              // to create a new message bubble instead of concatenating
              if (session.hadToolSinceLastText) {
                messageIndex++;
                session.hadToolSinceLastText = false;
              }
              resultText.push(block.text);
              session.streamingContent += block.text;
              if (session.streamingContent.length > MAX_STREAMING_BUFFER) {
                session.streamingContent = session.streamingContent.slice(-MAX_STREAMING_BUFFER);
              }
              callbacks.onText(block.text, messageIndex);
            }
            currentMessageText.push(block.text);
            hasText = true;
          } else if (block.type === "thinking" && block.thinking) {
            callbacks.onThinkingDelta?.(block.thinking);
          }
        }

        // Persist to DB
        if (hasText) {
          try {
            if (assistantMsgId === null) {
              // First turn: create new record
              const dbMsg = database.recordMessage(
                sessionId, "assistant", "assistant",
                currentMessageText.join(""),
              );
              assistantMsgId = dbMsg.id as number;
            } else {
              // Subsequent turns: update existing record with accumulated text
              database.updateMessage(assistantMsgId, resultText.join(""));
            }
          } catch (e) {
            log.error("Failed to record/update assistant message", { sessionId, error: String(e) });
          }

          // Signal intermediate completion
          // Note: Only include token fields when they have actual values (not null)
          // to prevent frontend from overwriting valid context state with null
          callbacks.onComplete({
            text: currentMessageText.join(""),
            sdk_session_id: null,
            cost: null,
            duration_ms: null,
            is_error: false,
            num_turns: null,
            model: session.model,
            message_index: messageIndex,
          });
        }
      } else if (message.type === "result") {
        gotResult = true;
        const result = message as any;

        session.sdkSessionId = result.session_id;
        log.debug("Query completed", { sessionId, sdkSessionId: result.session_id, resumed: resumeId === result.session_id });

        // Persist SDK session ID so next query can resume
        if (assistantMsgId !== null && result.session_id) {
          try {
            database.updateMessage(assistantMsgId, resultText.join(""), result.session_id);
            // Copy conversation file from worktree to main project dir for resume support
            copyWorktreeConversation(result.session_id, workspace);
          } catch (e) {
            log.error("Failed to update SDK session ID", { sessionId, error: String(e) });
          }
        }

        // If the SDK returned result text but no assistant messages were streamed
        // (e.g. slash command output), emit the result text to the frontend
        const sdkResultText = result.result as string | undefined;
        if (sdkResultText && resultText.length === 0) {
          resultText.push(sdkResultText);
          session.streamingContent += sdkResultText;
          if (session.streamingContent.length > MAX_STREAMING_BUFFER) {
            session.streamingContent = session.streamingContent.slice(-MAX_STREAMING_BUFFER);
          }
          callbacks.onText(sdkResultText, messageIndex);
        }

        // Extract context usage from SDK result
        const modelUsageValues: ModelUsage[] = Object.values(result.modelUsage || {});
        // Context usage = all input tokens (non-cached + cache_read + cache_creation)
        const usageObj = result.usage ?? {};
        const currentInputTokens = (usageObj.input_tokens || 0)
          + (usageObj.cache_read_input_tokens || 0)
          + (usageObj.cache_creation_input_tokens || 0);

        // Update fleet monitor with token counts
        fleetMonitor.updateSessionTokens(sessionId, currentInputTokens, usageObj.output_tokens || 0);
        // SDK contextWindow is the agent's working limit (200k), not the model's actual capacity
        const MODEL_CONTEXT_LIMITS: Record<string, number> = {
          'claude-sonnet-4-6': 1_000_000,
          'claude-opus-4-6': 1_000_000,
          'claude-haiku-4-5-20251001': 200_000,
        };
        const contextWindowSize = (session.model && MODEL_CONTEXT_LIMITS[session.model]) || 1_000_000;

        log.info("Context usage", {
          inputTokens: currentInputTokens,
          contextWindow: contextWindowSize,
          model: session.model,
          pct: Math.round((currentInputTokens / contextWindowSize) * 100),
        });

        lastCompletionData = {
          text: resultText.join(""),
          sdk_session_id: result.session_id,
          cost: result.total_cost_usd,
          duration_ms: result.duration_ms,
          is_error: result.is_error ?? (result.subtype !== "success"),
          num_turns: result.num_turns,
          input_tokens: usageObj.input_tokens || 0,
          output_tokens: result.usage?.output_tokens,
          cache_read_input_tokens: result.usage?.cache_read_input_tokens,
          cache_creation_input_tokens: result.usage?.cache_creation_input_tokens,
          context_window_size: contextWindowSize,
          model: session.model,
          message_index: messageIndex,
        };
      }
      // StreamEvent handling for token-level streaming
      else if ((message as any).type === "stream_event" || (message as any).event) {
        const eventData = (message as any).event ?? message;
        const eventType = eventData.type ?? "";
        if (eventType === "content_block_delta") {
          const delta = eventData.delta ?? {};
          if (delta.type === "text_delta" && delta.text) {
            streamEventsActive = true;
            // If a tool event occurred since the last text, increment messageIndex
            // to create a new message bubble instead of concatenating
            if (session.hadToolSinceLastText) {
              messageIndex++;
              session.hadToolSinceLastText = false;
            }
            resultText.push(delta.text);
            session.streamingContent += delta.text;
            if (session.streamingContent.length > MAX_STREAMING_BUFFER) {
              session.streamingContent = session.streamingContent.slice(-MAX_STREAMING_BUFFER);
            }
            callbacks.onText(delta.text, messageIndex);
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            callbacks.onThinkingDelta?.(delta.thinking);
          }
        } else if (eventType === "content_block_start") {
          const blockType = eventData.content_block?.type;
          if (blockType === "thinking") {
            callbacks.onThinkingStatus?.(true);
          } else if (blockType === "text") {
            callbacks.onThinkingStatus?.(false);
          }
        } else if (eventType === "message_stop") {
          // Extract usage data from message_stop event and update fleet monitor
          const usage = eventData.message?.usage ?? eventData.usage;
          if (usage) {
            const inputTokens = (usage.input_tokens || 0)
              + (usage.cache_read_input_tokens || 0)
              + (usage.cache_creation_input_tokens || 0);
            const outputTokens = usage.output_tokens || 0;

            // Accumulate tokens (message_stop fires after each assistant turn)
            cumulativeInputTokens += inputTokens;
            cumulativeOutputTokens += outputTokens;

            // Update fleet monitor with cumulative tokens
            fleetMonitor.updateSessionTokens(sessionId, cumulativeInputTokens, cumulativeOutputTokens);
          }
        }
      }
      // Tool progress: mid-tool elapsed time updates
      else if (message.type === 'tool_progress') {
        const msg = message as any;
        callbacks.onToolProgress?.({
          tool_use_id: msg.tool_use_id,
          elapsed_seconds: msg.elapsed_time_seconds ?? 0,
        });
      }
      // Rate limit events
      else if (message.type === 'rate_limit_event') {
        const msg = message as any;
        callbacks.onRateLimit?.({
          retryAfterMs: msg.retry_after_ms ?? 0,
          rateLimitedAt: new Date().toISOString(),
        });
      }
      // Prompt suggestions (predicted next prompts)
      else if (message.type === 'prompt_suggestion') {
        const msg = message as any;
        const suggestions = msg.suggestions ?? [];
        if (suggestions.length > 0) {
          callbacks.onPromptSuggestion?.(suggestions);
        }
      }
      // Context compaction boundary
      else if ((message as any).type === 'system' && (message as any).subtype === 'compact_boundary') {
        // Flush knowledge to memory before compaction
        if (config.getMemoryEnabled()) {
          distillSession(sessionId, workspace, { preCompaction: true }).catch(err => {
            log.warn('Pre-compaction memory flush failed', { sessionId, error: String(err) });
          });
        }
        callbacks.onCompactBoundary?.();
      }
      // API errors (overloaded, server errors, etc.)
      else if ((message as any).type === 'error') {
        const msg = message as any;
        const errorType = msg.error?.type ?? '';
        const errorMessage = msg.error?.message ?? String(msg);

        if (errorType === 'overloaded_error') {
          log.warn("API overloaded", { sessionId, errorType });
          callbacks.onError('Claude is currently overloaded. Please try again in a moment.');
        } else if (errorType === 'api_error') {
          log.warn("API internal error", { sessionId, errorType });
          callbacks.onError('Claude API encountered an internal error. Please try again.');
        } else {
          log.error("API error during streaming", { sessionId, errorType, errorMessage });
          callbacks.onError(errorMessage);
        }
      }
    }

    // Emit final completion
    if (gotResult && Object.keys(lastCompletionData).length > 0) {
      callbacks.onComplete(lastCompletionData);
      fleetMonitor.updateSessionStatus(sessionId, 'completed');

      // Notify Captain if this is a fleet session
      const sessionInfo = fleetMonitor.getSessionDetail(sessionId);
      if (sessionInfo) {
        captain.notifySessionComplete(sessionId, {
          requestedBy: sessionInfo.requestedBy,
          filesTouched: sessionInfo.filesTouched,
        });
      }
    }
  } catch (err) {
    const errorStr = String(err);
    let userMessage = errorStr;

    // Try to extract a cleaner message from API error JSON
    if (errorStr.includes('overloaded_error') || errorStr.includes('api_error')) {
      userMessage = 'Claude API is temporarily unavailable. Please try again in a moment.';
      log.warn("Transient API error (exception)", { sessionId, error: errorStr });
    } else {
      log.error("SDK query error", { sessionId, error: errorStr });
    }

    fleetMonitor.updateSessionStatus(sessionId, 'failed');
    callbacks.onError(userMessage);
    sessions.delete(sessionId);
  } finally {
    // Close query to release resources
    if (session.activeQuery) {
      try { session.activeQuery.close(); } catch { /* already closed */ }
    }

    session.activeQuery = null;
    session.streamingContent = '';

    // Always send completion so frontend cursor clears
    if (!gotResult) {
      callbacks.onComplete({
        text: resultText.join(""),
        sdk_session_id: null,
        cost: null,
        duration_ms: null,
        is_error: false,
        num_turns: null,
        input_tokens: null,
        output_tokens: null,
        model: session.model,
      });
    }

    // Fire-and-forget memory distillation
    if (config.getMemoryEnabled() && gotResult && !session.cancelRequested && resultText.length > 0) {
      distillSession(sessionId, workspace).catch(err => {
        log.warn('Memory distillation failed', { sessionId, error: String(err) });
      });
    }
  }
}
