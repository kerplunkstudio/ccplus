import { query, type Query, type HookCallback, type HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, writeFileSync, createWriteStream } from "fs";
import { homedir } from "os";
import path from "path";
import * as config from "./config.js";
import * as database from "./database.js";

// System prompt appended to every SDK session
const CCPLUS_SYSTEM_PROMPT = `
# cc+ Delegation Rules

You are running inside cc+, a multi-session web UI.

## Asking the user questions
When the user's request is ambiguous, has multiple valid approaches, or requires a choice, use the AskUserQuestion tool to present structured options. The cc+ UI renders these as selectable cards. Use it whenever you would normally ask the user to choose between approaches, confirm a direction, or clarify requirements. Do NOT just write out options as text — use AskUserQuestion so the user can click to select.

## Small tasks (handle directly)
Questions, reading files, explaining code, searching, quick single-file edits, small bug fixes — handle these yourself using any tools you need.

## Large tasks (delegate to a subagent)
Tasks that involve reading or writing MANY files, implementing features across multiple modules, large refactors, or multi-step implementation work — delegate these to a subagent.

How to delegate:
1. Say ONE short sentence (e.g., "Delegating to an agent.").
2. Call the Agent tool ONCE with:
   - \`subagent_type\`: "code_agent"
   - \`prompt\`: The user's full request, followed by:

\`\`\`
You have full autonomy to complete this task end-to-end. Steps:
1. Explore the codebase to understand the project structure and relevant files.
2. Implement all changes needed.
3. Run tests if applicable.
4. Commit your changes when done.
Do NOT ask for clarification. Make reasonable assumptions and proceed.
\`\`\`

3. STOP after the Agent call. Do not continue working.
`.trim();

// ---- Types ----

interface SessionCallbacks {
  onText: (text: string) => void;
  onToolEvent: (event: Record<string, unknown>) => void;
  onComplete: (result: Record<string, unknown>) => void;
  onError: (message: string) => void;
  onUserQuestion?: (data: Record<string, unknown>) => void;
  onThinkingDelta?: (text: string) => void;
}

interface ActiveSession {
  sessionId: string;
  workspace: string;
  model: string | null;
  sdkSessionId: string | null;
  activeQuery: Query | null;
  callbacks: SessionCallbacks | null;
  cancelRequested: boolean;
  pendingQuestion: {
    resolve: (value: Record<string, unknown>) => void;
    data: Record<string, unknown>;
  } | null;
}

// ---- Session Manager ----

const sessions = new Map<string, ActiveSession>();

function getOrCreateSession(sessionId: string, workspace: string, model?: string): ActiveSession {
  const existing = sessions.get(sessionId);
  if (existing) {
    // If workspace or model changed, reset
    if (
      (existing.workspace && existing.workspace !== workspace) ||
      (model && existing.model && existing.model !== model)
    ) {
      // Interrupt existing query if running
      if (existing.activeQuery) {
        existing.activeQuery.interrupt().catch(() => {});
      }
      sessions.delete(sessionId);
    } else {
      return existing;
    }
  }

  const session: ActiveSession = {
    sessionId,
    workspace,
    model: model ?? null,
    sdkSessionId: null,
    activeQuery: null,
    callbacks: null,
    cancelRequested: false,
    pendingQuestion: null,
  };
  sessions.set(sessionId, session);
  return session;
}

function getSdkSettingsPath(): string {
  const userSettingsPath = path.join(homedir(), ".claude", "settings.json");
  const sdkSettingsPath = path.join(config.DATA_DIR, "sdk_settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(userSettingsPath)) {
    try {
      settings = JSON.parse(readFileSync(userSettingsPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  // Disable plugins — their hooks can't resolve ${CLAUDE_PLUGIN_ROOT}
  delete settings.enabledPlugins;
  delete settings.extraKnownMarketplaces;

  writeFileSync(sdkSettingsPath, JSON.stringify(settings, null, 2));
  return sdkSettingsPath;
}

function safeParams(params: Record<string, unknown>): Record<string, unknown> {
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

function buildHooks(sessionId: string): Record<string, HookCallbackMatcher[]> {
  const toolTimers = new Map<string, number>();

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

    if (isAgent) {
      const event = {
        type: "agent_start",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ?? null,
        agent_type: (toolParams.subagent_type as string) ?? "agent",
        description: (toolParams.description as string) ?? ((toolParams.prompt as string) ?? "").slice(0, 100),
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      };
      session.callbacks.onToolEvent(event);
    } else {
      const event = {
        type: "tool_start",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ?? null,
        parameters: safeParams(toolParams),
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      };
      session.callbacks.onToolEvent(event);
    }

    // Record to database (success=null means "running")
    try {
      database.recordToolEvent(
        sessionId,
        toolName,
        actualToolUseId,
        isAgent ? undefined : (parentId ?? undefined),
        isAgent ? ((toolParams.subagent_type as string) ?? undefined) : undefined,
        null, // success = running
        null,
        null,
        isAgent ? undefined : JSON.stringify(safeParams(toolParams)),
      );
    } catch (e) {
      console.error("Database write failed (preToolUse):", e);
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
      const event: Record<string, unknown> = {
        type: "agent_stop",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        success: true,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      };
      session.callbacks.onToolEvent(event);
    } else {
      const event: Record<string, unknown> = {
        type: "tool_complete",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ?? null,
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
      }

      session.callbacks.onToolEvent(event);
    }

    try {
      database.updateToolEvent(sessionId, actualToolUseId, true, null, durationMs);
    } catch (e) {
      console.error("Database write failed (postToolUse):", e);
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
      session.callbacks.onToolEvent({
        type: "agent_stop",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        success: false,
        error: errorMsg,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      });
    } else {
      session.callbacks.onToolEvent({
        type: "tool_complete",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ?? null,
        success: false,
        error: errorMsg,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
      });
    }

    try {
      database.updateToolEvent(sessionId, actualToolUseId, false, errorMsg, durationMs);
    } catch (e) {
      console.error("Database write failed (postToolUseFailure):", e);
    }

    return {};
  };

  return {
    PreToolUse: [{ hooks: [preToolUse] }],
    PostToolUse: [{ hooks: [postToolUse] }],
    PostToolUseFailure: [{ hooks: [postToolUseFailure] }],
  };
}

// ---- Public API ----

export function submitQuery(
  sessionId: string,
  prompt: string,
  workspace: string,
  callbacks: SessionCallbacks,
  model?: string,
  imageIds?: string[],
): void {
  const session = getOrCreateSession(sessionId, workspace, model);
  session.callbacks = callbacks;
  session.cancelRequested = false;

  // Run query in background (don't await)
  streamQuery(session, prompt, workspace, model, imageIds).catch((err) => {
    console.error(`Stream query error for ${sessionId}:`, err);
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
      session.activeQuery.interrupt().catch(() => {});
    }
    // Unblock any pending question
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

export function getActiveSessions(): string[] {
  return [...sessions.entries()]
    .filter(([, s]) => s.activeQuery !== null)
    .map(([id]) => id);
}

export function disconnectSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session?.activeQuery) {
    session.activeQuery.interrupt().catch(() => {});
    session.activeQuery.close();
  }
  sessions.delete(sessionId);
}

export function sendQuestionResponse(sessionId: string, response: Record<string, unknown>): void {
  const session = sessions.get(sessionId);
  if (session?.pendingQuestion) {
    session.pendingQuestion.resolve(response);
    session.pendingQuestion = null;
  }
}

export function getPendingQuestion(sessionId: string): Record<string, unknown> | null {
  const session = sessions.get(sessionId);
  return session?.pendingQuestion?.data ?? null;
}

// ---- Internal streaming logic ----

async function streamQuery(
  session: ActiveSession,
  prompt: string,
  workspace: string,
  model?: string,
  imageIds?: string[],
): Promise<void> {
  const resultText: string[] = [];
  let gotResult = false;
  let assistantMsgId: number | null = null;

  const { sessionId } = session;
  const callbacks = session.callbacks;
  if (!callbacks) return;

  try {
    // Look up previous SDK session ID for resume
    const resumeId = database.getLastSdkSessionId(sessionId);

    // Build environment without CLAUDECODE
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "CLAUDECODE" && k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        cleanEnv[k] = v;
      }
    }

    // Build hooks
    const hooks = buildHooks(sessionId);

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
          setTimeout(() => {
            if (session.pendingQuestion) {
              session.pendingQuestion = null;
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

    // Build query content
    let queryContent: string | AsyncIterable<Record<string, unknown>> = prompt;

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
          console.error(`Failed to load image ${imgId}:`, e);
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

    // Start the query
    const q = query({
      prompt: queryContent as string,
      options: {
        model: model ?? config.SDK_MODEL,
        cwd: workspace,
        permissionMode: "bypassPermissions" as any,
        env: cleanEnv,
        hooks: hooks as any,
        resume: resumeId ?? undefined,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: CCPLUS_SYSTEM_PROMPT,
        } as any,
        canUseTool: canUseTool as any,
        maxTurns: 50,
        includePartialMessages: true,
      },
    });

    session.activeQuery = q;
    let lastCompletionData: Record<string, unknown> = {};

    for await (const message of q) {
      // Check cancellation
      if (session.cancelRequested) {
        await q.interrupt();
        break;
      }

      if (message.type === "assistant") {
        const msg = message as any;
        let hasText = false;
        const currentMessageText: string[] = [];

        for (const block of (msg.message?.content ?? [])) {
          if (block.type === "text") {
            resultText.push(block.text);
            currentMessageText.push(block.text);
            callbacks.onText(block.text);
            hasText = true;
          } else if (block.type === "thinking" && block.thinking) {
            callbacks.onThinkingDelta?.(block.thinking);
          }
        }

        // Persist to DB
        if (hasText) {
          try {
            const dbMsg = database.recordMessage(
              sessionId, "assistant", "assistant",
              currentMessageText.join(""),
            );
            if (assistantMsgId === null) {
              assistantMsgId = dbMsg.id as number;
            }
          } catch (e) {
            console.error("Failed to record assistant message:", e);
          }

          // Signal intermediate completion
          callbacks.onComplete({
            text: currentMessageText.join(""),
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
      } else if (message.type === "result") {
        gotResult = true;
        const result = message as any;

        session.sdkSessionId = result.session_id;

        lastCompletionData = {
          text: resultText.join(""),
          sdk_session_id: result.session_id,
          cost: result.total_cost_usd,
          duration_ms: result.duration_ms,
          is_error: result.is_error ?? (result.subtype !== "success"),
          num_turns: result.num_turns,
          input_tokens: result.usage?.input_tokens,
          output_tokens: result.usage?.output_tokens,
          model: session.model,
        };
      }
      // StreamEvent handling for token-level streaming
      else if ((message as any).type === "stream_event" || (message as any).event) {
        const eventData = (message as any).event ?? message;
        const eventType = eventData.type ?? "";
        if (eventType === "content_block_delta") {
          const delta = eventData.delta ?? {};
          if (delta.type === "text_delta" && delta.text) {
            resultText.push(delta.text);
            callbacks.onText(delta.text);
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            callbacks.onThinkingDelta?.(delta.thinking);
          }
        }
      }
    }

    // Emit final completion
    if (gotResult && Object.keys(lastCompletionData).length > 0) {
      callbacks.onComplete(lastCompletionData);
    }
  } catch (err) {
    console.error(`SDK query error for ${sessionId}:`, err);
    callbacks.onError(String(err));
    sessions.delete(sessionId);
  } finally {
    session.activeQuery = null;

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
  }
}
