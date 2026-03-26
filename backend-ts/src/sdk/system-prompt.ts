import path from "path";
import { discoverSkills } from "./skills.js";
import * as config from "../config.js";
import { searchMemories } from '../memory-client.js';
import { log } from "../logger.js";
import * as database from '../database.js';
import type { ResolvedAgent } from '../agent-config.js';
import { loadAllAgents } from '../agent-config.js';
import { loadWorkflow } from '../workflow-config.js';
import { getWorkflowState } from '../workflow-state.js';
import { formatAgentCatalog, formatWorkflowContext } from '../agent-catalog.js';

// System prompt appended to every SDK session
const CCPLUS_SYSTEM_PROMPT_BASE = `
# Session Instructions

You are an orchestrator running inside cc+. Your primary job is to delegate work to specialized agents via the Agent tool. For small tasks (single-file edits under 50 lines, config changes, answering questions), you may work directly.

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

## Workflow Phases
If a workflow is active, you will see an "Active Workflow" section below with the current phase and context. Each phase may restrict which tools you can use:
- **Blocked tools** will be denied if you attempt them in the current phase
- **Warned tools** will work but indicate you may be working out of order
- Follow the phase context instructions — they describe what to focus on in the current phase
- Phase transitions are managed by the Captain or the user, not by you

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

  if (agent?.personality) {
    prompt += `\n\n## Agent Personality\n${agent.personality}`;
  }

  if (agent?.soulContent) {
    prompt += `\n\n${agent.soulContent}`;
  }

  return prompt;
}
