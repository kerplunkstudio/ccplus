import path from "path";
import { discoverSkills } from "./skills.js";
import type { SkillInfo } from "./types.js";
import * as config from "../config.js";
import { searchMemories } from '../memory-client.js';
import { log } from "../logger.js";
import * as database from '../database.js';
import type { ResolvedAgent } from '../agent-config.js';
import { loadAllAgents } from '../agent-config.js';
import { loadWorkflow } from '../workflow-config.js';
import { getWorkflowState } from '../workflow-state.js';
import { formatAgentCatalog, formatWorkflowContext } from '../agent-catalog.js';
import { getAllMcpServers } from '../mcp-config.js';
import type { McpServerEntry } from '../mcp-config.js';

function buildAgentSkillsSection(
  agentSkills: { required?: string[]; available?: string[] },
  allSkills: SkillInfo[]
): string | null {
  const required = agentSkills.required ?? []
  const available = agentSkills.available ?? []
  if (required.length === 0 && available.length === 0) return null

  const findDesc = (name: string) => {
    const skill = allSkills.find(s => s.name === name)
    return skill?.description ? ` — ${skill.description}` : ''
  }

  const lines: string[] = ['## Agent Skills', 'You have access to these skills via the Skill tool:']

  if (required.length > 0) {
    lines.push('\n### Required (MUST consult before making changes):')
    for (const name of required) {
      lines.push(`- /${name}${findDesc(name)}`)
    }
  }

  if (available.length > 0) {
    lines.push('\n### Available (use when relevant):')
    for (const name of available) {
      lines.push(`- /${name}${findDesc(name)}`)
    }
  }

  lines.push('\nConsult required skills BEFORE starting implementation. Use available skills when they are relevant to the task.')
  return lines.join('\n')
}

function buildAgentMcpSection(
  agentMcpNames: string[],
  allMcpServers: McpServerEntry[]
): string | null {
  if (agentMcpNames.length === 0) return null

  const MCP_DESCRIPTIONS: Record<string, string> = {
    playwright: 'Browser automation and testing. Use for E2E tests, screenshots, and UI verification.',
    memory: 'Persistent memory storage and retrieval across sessions.',
    github: 'GitHub API access for repos, PRs, issues, and code search.',
    filesystem: 'File system access for reading and writing files.',
    fetch: 'HTTP requests and web content fetching.',
    'chrome-devtools': 'Chrome browser debugging and automation.',
  }

  const lines: string[] = [
    '## Available MCP Tools',
    'These MCP tool servers are available in your session. Use them for relevant tasks:',
  ]

  for (const name of agentMcpNames) {
    const entry = allMcpServers.find(s => s.name === name)
    const desc = MCP_DESCRIPTIONS[name] ?? (entry ? `${name} MCP server` : `${name} MCP server`)
    lines.push(`- ${name} — ${desc}`)
  }

  return lines.join('\n')
}

// System prompt appended to every SDK session
const CCPLUS_SYSTEM_PROMPT_BASE = `
# Session Instructions

You are an orchestrator running inside cc+. You delegate ALL work to specialized agents via the Agent tool. You do NOT use Read, Edit, Write, Grep, Glob, or Bash yourself — those are for agents.

Your only job:
1. Read the task prompt
2. Pick the right agent for the current workflow phase (check agent_hints in the Active Workflow section)
3. Spawn that agent with a clear, detailed prompt
4. When the agent completes, check the workflow phase and spawn the next agent
5. Repeat until the workflow reaches merge/complete

You NEVER:
- Read files to "understand the codebase" — the agent you spawn will do that
- Edit or write files — agents do that
- Run bash commands — agents do that
- Grep or glob for files — agents do that
- Do "a quick fix" yourself — there is no such thing, spawn an agent

The ONLY tools you use directly are: Agent (to spawn agents) and emit_status (to report your phase).

## Execution Environment
You may be running in a git worktree — an isolated copy of the repository. Your changes do not affect the main working tree until merged.
- Do NOT run \`git checkout\`, \`git stash\`, or \`git switch\` — these can corrupt the worktree
- Do NOT modify files outside the workspace directory
- Commit only your own changes; leave unrelated files untouched

## Observability
cc+ provides the \`emit_status\` tool for progress reporting. Call it ONCE when your activity type changes:
- "planning" — analyzing requirements, reading code to understand the task
- "implementing" — writing or editing code
- "testing" — running tests or writing test files
- "reviewing" — reviewing your own changes before completion
- "debugging" — diagnosing failures or unexpected behavior
- "researching" — searching docs, reading unfamiliar code, investigating options

Do NOT call between individual file edits. Call when your activity type changes, not on every tool use.

## Handling Failures
- **Tool failure**: Read the error. If transient (timeout, connection), retry once. If persistent, report to the user.
- **Test failure**: Read the output carefully. Fix the implementation, not the test (unless the test is wrong). After 3 failed attempts, stop and summarize what you tried.
- **Build failure**: Delegate to \`build-error-resolver\` agent with the full error output.
- **Permission denied**: Do not retry. Report to the user.
- **Stuck (>20 tool calls without progress)**: Stop, summarize what you have tried, and ask for direction.
- **Merge-cleanup failure**: If merge-cleanup agent fails, retry ONCE. If it fails again, do NOT fall back to execute phase. Instead, stop and report the error with full details (agent error message, workspace path, files that were supposed to be merged). The orchestrator (Captain) will handle manual cherry-pick.

## Workflow Phases
If a workflow is active, you will see an "Active Workflow" section below with the current phase and context. Each phase may restrict which tools you can use:
- **Blocked tools** will be denied if you attempt them in the current phase
- **Warned tools** will work but indicate you may be working out of order
- Follow the phase context instructions — they describe what to focus on in the current phase
- **Phase transitions happen automatically when you spawn the right agent.** Each phase lists \`agent_hints\` — spawning one of those agents auto-advances the workflow to the next phase. Do NOT try to use blocked tools directly; instead spawn the agent for the next phase and the transition will happen automatically.
- Example: in \`design\` phase, spawn \`planner\` → workflow advances to \`plan\`. In \`plan\` phase, spawn \`code_agent\` → advances to \`execute\`. The "To advance" instructions in the Active Workflow section tell you exactly which agents to spawn.

**MANDATORY: You MUST complete ALL workflow phases before finishing.**
- The workflow is NOT complete until the final phase (merge or complete) is reached
- After each agent finishes, check the current phase and spawn the agent listed in the CURRENT phase's \`agent_hints\`. Do NOT skip phases or hardcode a sequence — always follow the workflow definition.
- If code-reviewer returns BLOCK: spawn code_agent to fix issues, then re-spawn code-reviewer. Loop until READY or WARNING.
- NEVER consider the task "done" while remaining phases exist. Keep going until merge/complete.
- If merge-cleanup fails twice: STOP. Do not loop back to execute. Report what was completed and what failed.
- Maximum workflow cycles: if you have gone through execute→review→merge more than 2 times, STOP and report. Something is wrong.

## Turn Limit
Sessions have a maximum number of turns. If you are working on a large task, delegate early to specialized agents rather than doing everything directly. Prioritize the most critical work first.

## Slash Commands
Slash commands (messages starting with \`/\`) are automatically converted by the system. Execute the command's intent normally.

## User Questions
When clarification is needed, use the AskUserQuestion tool. The UI renders these as interactive cards. Use it instead of listing options as text.
`.trim();

export async function buildSystemPrompt(
  projectPath?: string,
  userPrompt?: string,
  sessionId?: string,
  agent?: ResolvedAgent,
  workflow?: string
): Promise<string> {
  const skills = discoverSkills(projectPath);
  let prompt = CCPLUS_SYSTEM_PROMPT_BASE;

  // Inject dynamic agent catalog
  try {
    const agents = await loadAllAgents(projectPath ?? process.cwd());
    const agentCatalog = formatAgentCatalog(agents);
    if (agentCatalog) {
      prompt += '\n\n' + agentCatalog;
    }
  } catch (error) {
    log.warn('Failed to load agent catalog for system prompt', { error: String(error) });
  }

  // Inject workflow context if workflow specified
  if (workflow && sessionId) {
    try {
      const workflowConfig = loadWorkflow(workflow);
      const workflowState = getWorkflowState(sessionId, workflow);
      const workflowContext = formatWorkflowContext(workflowConfig, workflowState.phase);
      if (workflowContext) {
        prompt += '\n\n' + workflowContext;
      }
    } catch (error) {
      log.warn('Failed to load workflow context for system prompt', { error: String(error) });
    }
  }

  if (skills.length > 0) {
    const skillLines = skills.map(s => {
      const desc = s.description ? ` - ${s.description}` : "";
      return `- /${s.name} (${s.plugin})${desc}`;
    });
    prompt += `\n\n## Available Skills\nThe following slash commands are available. Use the Skill tool to execute them:\n${skillLines.join("\n")}`;
  }

  // Agent-specific skills section
  if (agent?.skills) {
    const agentSkillsSection = buildAgentSkillsSection(agent.skills, skills)
    if (agentSkillsSection) {
      prompt += '\n\n' + agentSkillsSection
    }
  }

  // Agent-specific MCP tools section
  if (agent?.mcpServers?.length) {
    const mcpServers = getAllMcpServers(projectPath)
    const mcpSection = buildAgentMcpSection(agent.mcpServers, mcpServers)
    if (mcpSection) {
      prompt += '\n\n' + mcpSection
    }
  }

  // Inject relevant memories from knowledge base
  if (config.getMemoryEnabled() && userPrompt && sessionId) {
    const memStartMs = performance.now();
    try {
      const projectName = projectPath ? path.basename(projectPath) : '';
      const searchQuery = userPrompt; // Use full prompt for better retrieval
      const projectTag = projectName ? `project:${projectName}` : undefined;
      const memoryText = await searchMemories(searchQuery, config.MEMORY_MAX_RESULTS, projectTag);

      const memDurationMs = Math.round(performance.now() - memStartMs);
      const memoryCount = memoryText ? memoryText.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---')).length : 0;

      try {
        database.recordDistillation(sessionId, 'system-prompt-injection', !!memoryText, memoryCount, memDurationMs, null);
      } catch { /* never throw from observability */ }

      if (memoryText) {
        // Truncate to max inject size to prevent context bloat
        const truncated = memoryText.length > config.MEMORY_MAX_INJECT_TOKENS * 4
          ? memoryText.slice(0, config.MEMORY_MAX_INJECT_TOKENS * 4) + '\n...(truncated)'
          : memoryText;
        prompt += `\n\n## Prior Knowledge\n${truncated}`;
      }
    } catch (error) {
      const memDurationMs = Math.round(performance.now() - memStartMs);
      try {
        database.recordDistillation(sessionId, 'system-prompt-injection', false, 0, memDurationMs, error instanceof Error ? error.message : String(error));
      } catch { /* never throw from observability */ }
      log.warn('Failed to inject memories into system prompt', { error: String(error) });
    }
  }

  // Inject required skills instruction
  if (agent?.skills?.required && agent.skills.required.length > 0) {
    const skillLines = agent.skills.required.map((s: string) => `- /${s}`).join('\n');
    prompt += `\n\n## Required Skills\nBefore making changes, you MUST consult these skills using the Skill tool:\n${skillLines}\nApply their guidance to your implementation.`;
  }

  if (agent?.personality) {
    prompt += `\n\n## Agent Personality\n${agent.personality}`;
  }

  if (agent?.soulContent) {
    prompt += `\n\n${agent.soulContent}`;
  }

  return prompt;
}
