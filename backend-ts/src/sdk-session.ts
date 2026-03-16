import { query, type Query, type HookCallback, type HookCallbackMatcher, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, createWriteStream } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import path from "path";
import { z } from "zod";
import * as config from "./config.js";
import * as database from "./database.js";

// ---- Skills discovery (cached) ----

interface SkillInfo {
  name: string;
  plugin: string;
  description: string;
}

let cachedSkills: SkillInfo[] | null = null;

function parseDescription(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (match) {
      const descMatch = match[1].match(/description:\s*(.+)/);
      if (descMatch) return descMatch[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

function findClaudeBinary(): string | null {
  const candidates = [
    path.join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    path.join(homedir(), ".claude", "local", "claude"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const result = execFileSync("which", ["claude"], { encoding: "utf-8", timeout: 5000 }).trim();
    if (result) return result;
  } catch { /* ignore */ }
  return null;
}

function discoverSkills(projectPath?: string): SkillInfo[] {
  if (cachedSkills && !projectPath) return cachedSkills;

  const skills: SkillInfo[] = [];
  const claudeDir = path.join(homedir(), ".claude");

  // 1. User commands
  const userCmdDir = path.join(claudeDir, "commands");
  if (existsSync(userCmdDir)) {
    try {
      for (const file of readdirSync(userCmdDir)) {
        if (!file.endsWith(".md")) continue;
        const name = file.replace(/\.md$/, "");
        const desc = parseDescription(path.join(userCmdDir, file));
        skills.push({ name, plugin: "user", description: desc || "" });
      }
    } catch { /* ignore */ }
  }

  // 2. User skills
  const userSkillsDir = path.join(claudeDir, "skills");
  if (existsSync(userSkillsDir)) {
    try {
      for (const dir of readdirSync(userSkillsDir)) {
        const skillFile = path.join(userSkillsDir, dir, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        const desc = parseDescription(skillFile);
        skills.push({ name: dir, plugin: "skill", description: desc || "" });
      }
    } catch { /* ignore */ }
  }

  // 3. Plugin skills via Claude CLI
  try {
    const claudeBin = findClaudeBinary();
    if (claudeBin) {
      const output = execFileSync(claudeBin, ["plugin", "list", "--json"], {
        timeout: 30000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const plugins = JSON.parse(output.trim());
      if (Array.isArray(plugins)) {
        for (const plugin of plugins) {
          const pluginName = plugin.name || (plugin.id || "").split("@")[0];
          const installPath = plugin.installPath || "";
          if (installPath) {
            const skillsPath = path.join(installPath, ".claude", "skills");
            if (existsSync(skillsPath)) {
              try {
                for (const dir of readdirSync(skillsPath)) {
                  if (!statSync(path.join(skillsPath, dir)).isDirectory()) continue;
                  if (skills.some(s => s.name === dir)) continue;
                  const skillFile = path.join(skillsPath, dir, "SKILL.md");
                  const desc = existsSync(skillFile) ? parseDescription(skillFile) : null;
                  skills.push({ name: dir, plugin: pluginName, description: desc || "" });
                }
              } catch { /* ignore */ }
            }
            const cmdDir = path.join(installPath, "commands");
            if (existsSync(cmdDir)) {
              try {
                for (const file of readdirSync(cmdDir)) {
                  if (!file.endsWith(".md")) continue;
                  const name = file.replace(/\.md$/, "");
                  if (skills.some(s => s.name === name)) continue;
                  const desc = parseDescription(path.join(cmdDir, file));
                  skills.push({ name, plugin: pluginName, description: desc || "" });
                }
              } catch { /* ignore */ }
            }
          }
          if (Array.isArray(plugin.skills)) {
            for (const skillName of plugin.skills) {
              if (skills.some(s => s.name === skillName)) continue;
              skills.push({ name: skillName, plugin: pluginName, description: "" });
            }
          }
        }
      }
    }
  } catch { /* ignore */ }

  // 4. Project-level commands
  if (projectPath) {
    const projCmdDir = path.join(projectPath, ".claude", "commands");
    if (existsSync(projCmdDir)) {
      try {
        for (const file of readdirSync(projCmdDir)) {
          if (!file.endsWith(".md")) continue;
          const name = file.replace(/\.md$/, "");
          if (skills.some(s => s.name === name)) continue;
          const desc = parseDescription(path.join(projCmdDir, file));
          skills.push({ name, plugin: "project", description: desc || "" });
        }
      } catch { /* ignore */ }
    }
  }

  if (!projectPath) cachedSkills = skills;
  return skills;
}

// Discover installed plugin paths for the SDK plugins option
let cachedPluginPaths: Array<{ type: "local"; path: string }> | null = null;

function getInstalledPlugins(): Array<{ type: "local"; path: string }> {
  if (cachedPluginPaths) return cachedPluginPaths;

  const result: Array<{ type: "local"; path: string }> = [];
  try {
    const claudeBin = findClaudeBinary();
    if (claudeBin) {
      const output = execFileSync(claudeBin, ["plugin", "list", "--json"], {
        timeout: 30000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const plugins = JSON.parse(output.trim());
      if (Array.isArray(plugins)) {
        for (const plugin of plugins) {
          const installPath = plugin.installPath || "";
          if (installPath && existsSync(installPath)) {
            result.push({ type: "local", path: installPath });
          }
        }
      }
    }
  } catch { /* ignore */ }

  cachedPluginPaths = result;
  return result;
}

export { discoverSkills, type SkillInfo };

// System prompt appended to every SDK session
const CCPLUS_SYSTEM_PROMPT_BASE = `
# cc+ Environment

You are running inside cc+, a web UI for Claude Code with multi-session support.

## Slash Commands
When the user requests a slash command (e.g., "Run the /animate slash command"), call the Skill tool with the command name: Skill({ skill: "animate" }).

## User Questions
When clarification is needed, use the AskUserQuestion tool. The UI renders these as interactive cards. Use it instead of listing options as text.

## Observability Tools
cc+ provides custom tools for reporting your progress to the UI:
- **emit_status**: Report phase transitions (planning, implementing, testing, reviewing, debugging, researching). Call when you begin a new phase.
- **emit_plan**: Share your work plan as a list of steps. Call before starting multi-step work.
- **emit_progress**: Update individual step status (active/done/skipped). Call as you complete steps.

These tools are lightweight and have no side effects. Use them to keep the user informed during longer tasks.

## When to Delegate
Consider spawning a subagent (Agent tool, typically with subagent_type "code_agent") when:
- The task spans many files or modules
- Parallel workstreams would help (e.g., implementing multiple features independently)
- Verbose tool output would clutter the conversation (e.g., large refactors, build troubleshooting)
- The work benefits from isolated context (e.g., exploring an unfamiliar codebase section)

Direct work often works better for:
- Targeted single-file edits or quick fixes
- Tasks where you need to see all tool output to guide next steps
- Iterative refinement across multiple files where context matters
- Work that requires tight feedback loops with the user

When delegating, provide clear autonomy: "You have full autonomy to complete this task. Explore the codebase, implement changes, test, and commit when done."
`.trim();

function buildSystemPrompt(projectPath?: string): string {
  const skills = discoverSkills(projectPath);
  if (skills.length === 0) return CCPLUS_SYSTEM_PROMPT_BASE;

  const skillLines = skills.map(s => {
    const desc = s.description ? ` - ${s.description}` : "";
    return `- /${s.name} (${s.plugin})${desc}`;
  });

  return `${CCPLUS_SYSTEM_PROMPT_BASE}\n\n## Available Skills\nThe following slash commands are available. Use the Skill tool to execute them:\n${skillLines.join("\n")}`;
}

// ---- Types ----

interface SessionCallbacks {
  onText: (text: string) => void;
  onToolEvent: (event: Record<string, unknown>) => void;
  onComplete: (result: Record<string, unknown>) => void;
  onError: (message: string) => void;
  onUserQuestion?: (data: Record<string, unknown>) => void;
  onThinkingDelta?: (text: string) => void;
  onSignal?: (signal: { type: string; data: Record<string, unknown> }) => void;
  onToolProgress?: (data: { tool_use_id: string; elapsed_seconds: number }) => void;
  onRateLimit?: (data: { retryAfterMs: number; rateLimitedAt: string }) => void;
  onPromptSuggestion?: (suggestions: string[]) => void;
  onCompactBoundary?: () => void;
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
  const agentIdToToolUseId = new Map<string, string>();
  const agentStopData = new Map<string, { transcriptPath?: string; lastMessage?: string }>();
  const pendingAgentToolUseIds: string[] = [];

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
      pendingAgentToolUseIds.push(actualToolUseId);
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
        parent_agent_id: parentId ? (agentIdToToolUseId.get(parentId) ?? parentId) : null,
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
        isAgent ? undefined : (parentId ? (agentIdToToolUseId.get(parentId) ?? parentId) : undefined),
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
      const stopData = agentStopData.get(actualToolUseId);
      const event: Record<string, unknown> = {
        type: "agent_stop",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        success: true,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        transcript_path: stopData?.transcriptPath ?? null,
        summary: stopData?.lastMessage ?? null,
      };
      session.callbacks.onToolEvent(event);

      // Clean up agent_id mapping and stop data
      for (const [agentId, tuId] of agentIdToToolUseId.entries()) {
        if (tuId === actualToolUseId) {
          agentIdToToolUseId.delete(agentId);
          break;
        }
      }
      agentStopData.delete(actualToolUseId);
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
      const stopData = agentStopData.get(actualToolUseId);
      session.callbacks.onToolEvent({
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

      // Clean up agent_id mapping and stop data
      for (const [agentId, tuId] of agentIdToToolUseId.entries()) {
        if (tuId === actualToolUseId) {
          agentIdToToolUseId.delete(agentId);
          break;
        }
      }
      agentStopData.delete(actualToolUseId);
    } else {
      session.callbacks.onToolEvent({
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
    }

    try {
      database.updateToolEvent(sessionId, actualToolUseId, false, errorMsg, durationMs);
    } catch (e) {
      console.error("Database write failed (postToolUseFailure):", e);
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

// ---- MCP Signal Server ----

function buildSignalServer(sessionId: string, callbacks: SessionCallbacks) {
  return createSdkMcpServer({
    name: "ccplus-signals",
    version: "1.0.0",
    tools: [
      tool(
        "emit_status",
        "Report your current work phase to the cc+ UI. Call this when transitioning between phases (planning, implementing, testing, etc.)",
        {
          phase: z.enum(["planning", "implementing", "testing", "reviewing", "debugging", "researching"]),
          detail: z.string().optional(),
        },
        async (args) => {
          callbacks.onSignal?.({ type: "status", data: args });
          return { content: [{ type: "text" as const, text: "Status reported." }] };
        },
      ),
      tool(
        "emit_plan",
        "Report a structured work plan to the cc+ UI. Call this before starting multi-step work.",
        {
          steps: z.array(z.object({
            label: z.string(),
            status: z.enum(["pending", "active", "done", "skipped"]).optional(),
          })),
        },
        async (args) => {
          callbacks.onSignal?.({ type: "plan", data: args });
          return { content: [{ type: "text" as const, text: "Plan reported." }] };
        },
      ),
      tool(
        "emit_progress",
        "Update a specific step in your work plan in the cc+ UI. Call this as you complete steps.",
        {
          stepIndex: z.number().int().min(0),
          status: z.enum(["active", "done", "skipped"]),
          detail: z.string().optional(),
        },
        async (args) => {
          callbacks.onSignal?.({ type: "progress", data: args });
          return { content: [{ type: "text" as const, text: "Progress updated." }] };
        },
      ),
    ],
  });
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
  let streamEventsActive = false;

  const { sessionId } = session;
  const callbacks = session.callbacks;
  if (!callbacks) return;

  try {
    // Look up previous SDK session ID for resume
    const resumeId = database.getLastSdkSessionId(sessionId);
    console.log(`[sdk-session] Query for ${sessionId}: resume=${resumeId ?? 'none'}, cwd=${workspace}`);

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

    // Load installed plugins so the SDK subprocess can execute skills
    const installedPlugins = getInstalledPlugins();

    // Build signal server for progress reporting
    const signalServer = buildSignalServer(sessionId, callbacks);

    const q = query({
      prompt: queryContent as string,
      options: {
        model: model ?? config.SDK_MODEL,
        cwd: workspace,
        settingSources: ['user', 'project'],
        permissionMode: "bypassPermissions" as any,
        allowDangerouslySkipPermissions: true,
        env: cleanEnv,
        hooks: hooks as any,
        plugins: installedPlugins.length > 0 ? installedPlugins as any : undefined,
        mcpServers: {
          "ccplus-signals": signalServer,
        } as any,
        resume: resumeId ?? undefined,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: buildSystemPrompt(workspace),
        } as any,
        canUseTool: canUseTool as any,
        maxTurns: 50,
        includePartialMessages: true,
        promptSuggestions: true,
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
            if (!streamEventsActive) {
              resultText.push(block.text);
              callbacks.onText(block.text);
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
        console.log(`[sdk-session] Result for ${sessionId}: sdk_session=${result.session_id}, resumed=${resumeId === result.session_id ? 'yes' : 'new_session'}`);

        // Persist SDK session ID so next query can resume
        if (assistantMsgId !== null && result.session_id) {
          try {
            database.updateMessage(assistantMsgId, resultText.join(""), result.session_id);
          } catch (e) {
            console.error("Failed to update SDK session ID:", e);
          }
        }

        // If the SDK returned result text but no assistant messages were streamed
        // (e.g. slash command output), emit the result text to the frontend
        const sdkResultText = result.result as string | undefined;
        if (sdkResultText && resultText.length === 0) {
          resultText.push(sdkResultText);
          callbacks.onText(sdkResultText);
        }

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
            streamEventsActive = true;
            resultText.push(delta.text);
            callbacks.onText(delta.text);
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            callbacks.onThinkingDelta?.(delta.thinking);
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
        callbacks.onCompactBoundary?.();
      }
    }

    // Emit final completion
    if (gotResult && Object.keys(lastCompletionData).length > 0) {
      callbacks.onComplete(lastCompletionData);
    }
  } catch (err) {
    console.error(`[sdk-session] SDK query CATCH for ${sessionId}:`, err);
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
