import path from "path";
import { discoverSkills } from "./skills.js";
import * as config from "../config.js";
import { searchMemories } from '../memory-client.js';
import { log } from "../logger.js";

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

export async function buildSystemPrompt(projectPath?: string, userPrompt?: string, sessionId?: string): Promise<string> {
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
