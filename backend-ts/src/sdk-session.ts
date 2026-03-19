import { query, type Query, type HookCallback, type HookCallbackMatcher, createSdkMcpServer, tool, type ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, createWriteStream } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import path from "path";
import { z } from "zod";
import * as config from "./config.js";
import * as database from "./database.js";
import { findClaudeBinary } from "./utils.js";
import { getAllMcpServers, buildSdkMcpServers } from "./mcp-config.js";
import { log } from "./logger.js";
import { searchMemories } from './memory-client.js';
import { distillSession } from './memory-distiller.js';
import { eventLog } from './event-log.js';
import { evaluatePreToolUse, getPhaseContext, getWorkflowState, inferPhaseFromAgent, transitionPhase } from './workflow-state.js';
import { WORKFLOW_ENABLED } from './config.js';

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
  } catch (err) {
    console.error('Failed to parse description from', filePath, ':', err);
  }
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
    } catch (err) {
      console.error('Failed to discover user commands:', err);
    }
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
    } catch (err) {
      console.error('Failed to discover user skills:', err);
    }
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
              } catch (err) {
                console.error(`Failed to discover skills from plugin ${pluginName}:`, err);
              }
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
              } catch (err) {
                console.error(`Failed to discover commands from plugin ${pluginName}:`, err);
              }
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
  } catch (err) {
    console.error('Failed to discover plugin skills via Claude CLI:', err);
  }

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
      } catch (err) {
        console.error('Failed to discover project commands:', err);
      }
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
  } catch (err) {
    console.error('Failed to get installed plugins via Claude CLI:', err);
  }

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
cc+ provides a custom tool for reporting your progress to the UI:
- **emit_status**: Report phase transitions (planning, implementing, testing, reviewing, debugging, researching). Call when you begin a new phase.

This tool is lightweight and has no side effects. Use it to keep the user informed during longer tasks.

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

## Mandatory Workflow

When starting a feature, refactor, or any non-trivial task, you MUST follow this sequence using superpowers skills:

1. **Plan**: Spawn a planner agent (Agent tool with subagent_type "planner"). The planner MUST use the brainstorming and writing-plans skills.
2. **Execute**: Spawn code_agent or frontend-agent. They MUST use the executing-plans and test-driven-development skills.
3. **Review**: Spawn a code-reviewer agent (Agent tool with subagent_type "code-reviewer"). It MUST use the requesting-code-review skill.
4. **Verify**: All agents MUST use the verification-before-completion skill before claiming work is done.

Do NOT use the native EnterPlanMode tool — always use the planner agent with skills.
Do NOT skip phases. If the user asks you to "just do it", still plan first.

Exceptions (you may skip planning):
- Bug fixes touching fewer than 3 files
- Config-only changes (.env, settings)
- Documentation-only changes

Exceptions (you may skip review):
- Config-only changes
- Documentation-only changes
- Test-only changes
`.trim();

async function buildSystemPrompt(projectPath?: string, userPrompt?: string, sessionId?: string): Promise<string> {
  const skills = discoverSkills(projectPath);
  let prompt = CCPLUS_SYSTEM_PROMPT_BASE;

  if (skills.length > 0) {
    const skillLines = skills.map(s => {
      const desc = s.description ? ` - ${s.description}` : "";
      return `- /${s.name} (${s.plugin})${desc}`;
    });
    prompt += `\n\n## Available Skills\nThe following slash commands are available. Use the Skill tool to execute them:\n${skillLines.join("\n")}`;
  }

  // Inject relevant memories from knowledge base
  if (config.MEMORY_ENABLED && userPrompt) {
    try {
      const projectName = projectPath ? path.basename(projectPath) : '';
      const searchQuery = userPrompt.slice(0, 200);
      const projectTag = projectName ? `project:${projectName}` : undefined;
      const memoryText = await searchMemories(searchQuery, config.MEMORY_MAX_RESULTS, projectTag);

      if (memoryText) {
        // Truncate to max inject size to prevent context bloat
        const truncated = memoryText.length > config.MEMORY_MAX_INJECT_TOKENS * 4
          ? memoryText.slice(0, config.MEMORY_MAX_INJECT_TOKENS * 4) + '\n...(truncated)'
          : memoryText;
        prompt += `\n\n## Prior Knowledge\n${truncated}`;
      }
    } catch (error) {
      log.warn('Failed to inject memories into system prompt', { error: String(error) });
    }
  }

  return prompt;
}

// ---- Types ----

interface SessionCallbacks {
  onText: (text: string, messageIndex: number) => void;
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
  onDevServerDetected?: (url: string) => void;
  onCaptureScreenshot?: () => Promise<{ image?: string; url?: string; error?: string }>;
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
  questionTimeout: NodeJS.Timeout | null;
  streamingContent: string;
}

// ---- Session Manager ----

const sessions = new Map<string, ActiveSession>();

// Maximum buffer size for streaming content (2MB)
// This buffer is only used for reconnection sync, so trimming from the front is acceptable
const MAX_STREAMING_BUFFER = 2 * 1024 * 1024;

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
        existing.activeQuery.interrupt().catch((err) => {
          log.error("Failed to interrupt query during session reset", { sessionId, error: String(err) });
        });
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
    questionTimeout: null,
    streamingContent: '',
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
  const detectedDevServerUrls = new Set<string>();

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
      const event = {
        type: "agent_start",
        tool_name: toolName,
        tool_use_id: actualToolUseId,
        parent_agent_id: parentId ?? null,
        agent_type: (toolParams.subagent_type as string) ?? "agent",
        description: agentDescription,
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

      // Emit dedicated todo_update for TodoWrite tools
      if (toolName === 'TodoWrite') {
        const todos = toolParams.todos as Array<{ content: string; status: string; activeForm: string }> | undefined;
        if (todos) {
          session.callbacks.onToolEvent({
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
      }

      session.callbacks.onToolEvent(event);

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

      // Update database with summary (for failed agents)
      try {
        database.updateToolEvent(sessionId, actualToolUseId, false, errorMsg, durationMs, stopData?.lastMessage ?? null);
      } catch (e) {
        log.error("Database write failed (postToolUseFailure agent)", { sessionId, toolName, toolUseId: actualToolUseId, error: String(e) });
      }
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
        const searchQuery = (description + ' ' + prompt.slice(0, 200)).trim();

        if (searchQuery.length > 10) {
          const projectName = session?.workspace ? path.basename(session.workspace) : '';
          const projectTag = projectName ? `project:${projectName}` : undefined;

          const timeoutPromise = new Promise<string>(resolve =>
            setTimeout(() => resolve(''), config.MEMORY_HOOK_TIMEOUT_MS)
          );
          const memoryText = await Promise.race([
            searchMemories(searchQuery, 3, projectTag),
            timeoutPromise,
          ]);
          if (memoryText) {
            memoryContext = `## Prior Knowledge\n${memoryText}`;
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

  // Force-close stale query if one is lingering
  if (session.activeQuery !== null) {
    log.warn("Forcing cleanup of stale query", { sessionId });
    try {
      session.activeQuery.interrupt().catch(() => {});
      session.activeQuery.close();
    } catch {
      // already closed or invalid
    }
    session.activeQuery = null;
    session.streamingContent = '';
    session.cancelRequested = false;
  }

  session.callbacks = callbacks;
  session.cancelRequested = false;

  // Run query in background (don't await)
  streamQuery(session, prompt, workspace, model, imageIds).catch((err) => {
    log.error("Stream query error", { sessionId, error: String(err) });
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
      session.activeQuery.interrupt().catch((err) => {
        log.error("Failed to interrupt query during cancellation", { sessionId, error: String(err) });
      });
    }
    // Clear question timeout and unblock any pending question
    if (session.questionTimeout) {
      clearTimeout(session.questionTimeout);
      session.questionTimeout = null;
    }
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
    session.activeQuery.interrupt().catch((err) => {
      log.error("Failed to interrupt query during disconnect", { sessionId, error: String(err) });
    });
    session.activeQuery.close();
  }
  eventLog.clear(sessionId);
  sessions.delete(sessionId);
}

export function sendQuestionResponse(sessionId: string, response: Record<string, unknown>): void {
  const session = sessions.get(sessionId);
  if (session?.pendingQuestion) {
    if (session.questionTimeout) {
      clearTimeout(session.questionTimeout);
      session.questionTimeout = null;
    }
    session.pendingQuestion.resolve(response);
    session.pendingQuestion = null;
  }
}

export function getPendingQuestion(sessionId: string): Record<string, unknown> | null {
  const session = sessions.get(sessionId);
  return session?.pendingQuestion?.data ?? null;
}

export function getStreamingContent(sessionId: string): string {
  const session = sessions.get(sessionId);
  return session?.streamingContent ?? '';
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
        "VerifyApp",
        "Take a screenshot of the running web application in the browser tab. Use this to verify visual changes, check layouts, and inspect the UI. Returns a screenshot image of the app.",
        {
          url: z.string().optional().describe("Optional specific URL to verify. If not provided, captures the current page."),
        },
        async (args) => {
          if (!callbacks.onCaptureScreenshot) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Screenshot capability not available. No browser tab is open or the app is running in a non-Electron environment.",
                },
              ],
            };
          }

          try {
            const result = await callbacks.onCaptureScreenshot();

            if (result.error) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error capturing screenshot: ${result.error}`,
                  },
                ],
              };
            }

            if (!result.image) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Error: No image data returned from browser tab.",
                  },
                ],
              };
            }

            // Return both text description and the image
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Screenshot captured of ${result.url || "browser tab"}. The image shows the current state of the web application.`,
                },
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: result.image,
                  },
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Failed to capture screenshot: ${String(error)}`,
                },
              ],
            };
          }
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
  let lastCompletionData: Record<string, unknown> = {};
  let messageIndex = 0;

  const { sessionId } = session;
  const callbacks = session.callbacks;
  if (!callbacks) return;

  // Reset streaming content at the start of each query
  session.streamingContent = '';

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

    const q = query({
      prompt: queryContent as string,
      options: {
        model: model ?? config.SDK_MODEL,
        cwd: workspace,
        settingSources: ['user', 'project'],
        permissionMode: config.BYPASS_PERMISSIONS ? "bypassPermissions" as any : undefined,
        allowDangerouslySkipPermissions: config.BYPASS_PERMISSIONS,
        env: cleanEnv,
        hooks: hooks as any,
        plugins: installedPlugins.length > 0 ? installedPlugins as any : undefined,
        mcpServers: {
          "ccplus-signals": signalServer,
          ...userMcpServers,
        } as any,
        resume: resumeId ?? undefined,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: await buildSystemPrompt(workspace, prompt, sessionId),
        } as any,
        canUseTool: canUseTool as any,
        maxTurns: 50,
        includePartialMessages: true,
        promptSuggestions: true,
      },
    });

    session.activeQuery = q;

    for await (const message of q) {
      // Check cancellation
      if (session.cancelRequested) {
        await q.interrupt();
        try { q.close(); } catch { /* already closed */ }
        break;
      }

      // DEBUG: Log every message type from SDK
      writeFileSync("/tmp/ccplus-msg-types.log",
        JSON.stringify({ type: message.type, keys: Object.keys(message as any) }) + "\n",
        { flag: "a" });

      if (message.type === "assistant") {
        messageIndex++;
        const msg = message as any;
        let hasText = false;
        const currentMessageText: string[] = [];

        for (const block of (msg.message?.content ?? [])) {
          if (block.type === "text") {
            if (!streamEventsActive) {
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

        writeFileSync("/tmp/ccplus-context-debug.log", JSON.stringify({
          modelUsage: result.modelUsage,
          usage: result.usage,
          inputTokens: currentInputTokens,
          contextWindow: contextWindowSize,
          model: session.model,
        }, null, 2) + "\n", { flag: "a" });

        lastCompletionData = {
          text: resultText.join(""),
          sdk_session_id: result.session_id,
          cost: result.total_cost_usd,
          duration_ms: result.duration_ms,
          is_error: result.is_error ?? (result.subtype !== "success"),
          num_turns: result.num_turns,
          input_tokens: currentInputTokens,
          output_tokens: result.usage?.output_tokens,
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
            resultText.push(delta.text);
            session.streamingContent += delta.text;
            if (session.streamingContent.length > MAX_STREAMING_BUFFER) {
              session.streamingContent = session.streamingContent.slice(-MAX_STREAMING_BUFFER);
            }
            callbacks.onText(delta.text, messageIndex);
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
        // Flush knowledge to memory before compaction
        if (config.MEMORY_ENABLED) {
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
    if (config.MEMORY_ENABLED && gotResult && !session.cancelRequested && resultText.length > 0) {
      distillSession(sessionId, workspace).catch(err => {
        log.warn('Memory distillation failed', { sessionId, error: String(err) });
      });
    }
  }
}
