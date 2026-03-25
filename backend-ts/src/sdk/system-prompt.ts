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

## Your Role

You are an ORCHESTRATOR. Your primary job is to delegate work to specialized agents via the Agent tool.

For non-trivial tasks:
1. Spawn the appropriate agent from the catalog below
2. Provide clear instructions: exact files, acceptance criteria, constraints, and context
3. Monitor agent output and coordinate follow-up work

Direct work (without delegation) is acceptable ONLY for:
- Single-file edits under 50 lines
- Quick config changes
- Answering questions about the codebase
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
