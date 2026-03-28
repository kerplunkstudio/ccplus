import type { ResolvedAgent } from './agent-config.js';
import type { WorkflowConfig } from './workflow-config.js';

/**
 * Formats a list of agents into a markdown catalog for LLM system prompts.
 * Returns empty string if agents array is empty.
 */
export function formatAgentCatalog(agents: ResolvedAgent[]): string {
  if (!agents || agents.length === 0) {
    return '';
  }

  const rows = agents.map((agent) => {
    const name = agent.name || 'unknown';
    const description = agent.description || '';
    const model = agent.model || 'default';
    const toolRestrictions = formatToolRestrictions(agent);

    return `| ${name} | ${description} | ${model} | ${toolRestrictions} |`;
  });

  return `## Available Agents

| Agent | Description | Model | Tool Restrictions |
|-------|-------------|-------|-------------------|
${rows.join('\n')}

Use the Agent tool to delegate to these specialists.`;
}

/**
 * Formats a list of agents into a markdown catalog specifically for Captain.
 * Captain does NOT use agents directly — sessions launched via start_session do.
 * Returns empty string if agents array is empty.
 */
export function formatAgentCatalogForCaptain(agents: ResolvedAgent[]): string {
  if (!agents || agents.length === 0) {
    return '';
  }

  const rows = agents.map((agent) => {
    const name = agent.name || 'unknown';
    const description = agent.description || '';
    const model = agent.model || 'default';
    const toolRestrictions = formatToolRestrictions(agent);

    return `| ${name} | ${description} | ${model} | ${toolRestrictions} |`;
  });

  return `## Agents Available to Sessions

Sessions launched via start_session have access to these specialized agents. Reference them in your session prompts to guide delegation. You do NOT use these agents directly — sessions do.

| Agent | Description | Model | Tool Restrictions |
|-------|-------------|-------|-------------------|
${rows.join('\n')}

**When writing session prompts:**
- Reference agents by name to guide the session orchestrator (e.g., "The frontend-agent should handle component changes")
- Sessions will delegate to these agents based on the task
- You remain the fleet orchestrator — sessions handle agent delegation`;
}

/**
 * Formats tool restrictions for a single agent.
 */
function formatToolRestrictions(agent: ResolvedAgent): string {
  const tools = agent.tools;

  if (!tools) {
    return 'All tools';
  }

  if (tools.blocked && tools.blocked.length > 0) {
    return `All except: ${tools.blocked.join(', ')}`;
  }

  if (tools.allowed && tools.allowed.length > 0) {
    return `${tools.allowed.join(', ')} only`;
  }

  return 'All tools';
}

/**
 * Formats workflow phase tool enforcement rules into markdown.
 * Returns empty string if workflow is null or has no phases.
 */
export function formatPhaseEnforcement(workflow: WorkflowConfig | null): string {
  if (!workflow || !workflow.phases || workflow.phases.length === 0) {
    return '';
  }

  const phaseBlocks: string[] = [];

  for (const phase of workflow.phases) {
    const phaseName = phase.name;
    const toolRules = phase.tool_rules;

    if (!toolRules || toolRules.length === 0) {
      phaseBlocks.push(`### ${phaseName}\n- All tools allowed`);
      continue;
    }

    const blocked: string[] = [];
    const warned: string[] = [];

    for (const rule of toolRules) {
      if (rule.action === 'block') {
        blocked.push(rule.tool_name);
      } else if (rule.action === 'warn') {
        warned.push(rule.tool_name);
      }
    }

    const lines: string[] = [`### ${phaseName}`];

    if (blocked.length > 0) {
      lines.push(`- **Blocked**: ${blocked.join(', ')}`);
    }

    if (warned.length > 0) {
      lines.push(`- **Warned**: ${warned.join(', ')}`);
    }

    if (blocked.length === 0 && warned.length === 0) {
      lines.push('- All tools allowed');
    }

    phaseBlocks.push(lines.join('\n'));
  }

  return `## Phase Enforcement

Each workflow phase restricts which tools can be used:

${phaseBlocks.join('\n\n')}`;
}

/**
 * Formats workflow context including phase sequence and current phase details.
 * Returns empty string if workflow is null.
 */
export function formatWorkflowContext(workflow: WorkflowConfig | null, currentPhase?: string): string {
  if (!workflow || !workflow.phases || workflow.phases.length === 0 || !workflow.transitions) {
    return '';
  }

  const workflowName = workflow.name || 'unknown';
  const phaseSequence = workflow.phases.map((p) => p.name).join(' → ');

  let result = `## Active Workflow: ${workflowName}

**Phases**: ${phaseSequence}`;

  if (currentPhase) {
    const currentIndex = workflow.phases.findIndex((p) => p.name === currentPhase);
    const phase = currentIndex >= 0 ? workflow.phases[currentIndex] : undefined;

    if (phase) {
      result += `\n\n### Current Phase: ${currentPhase}`;

      if (phase.context) {
        result += `\n\n${phase.context}`;
      }

      if (phase.agent_hints && phase.agent_hints.length > 0) {
        result += `\n\n**Agents for this phase**: ${phase.agent_hints.join(', ')}`;
      }

      const validTransitions = workflow.transitions
        .filter((t) => t.from === currentPhase)
        .map((t) => t.to);

      if (validTransitions.length > 0) {
        result += `\n\n### Valid Transitions from ${currentPhase}`;
        validTransitions.forEach((to) => {
          const nextPhase = workflow.phases.find((p) => p.name === to);
          const hints = nextPhase?.agent_hints ?? [];
          const hintStr = hints.length > 0 ? ` — spawn one of: ${hints.join(', ')}` : '';
          result += `\n- ${to}${hintStr}`;
        });

        // Show the primary next phase advance instruction prominently
        const primaryNext = validTransitions[0];
        const primaryPhase = workflow.phases.find((p) => p.name === primaryNext);
        const primaryHints = primaryPhase?.agent_hints ?? [];
        if (primaryHints.length > 0) {
          result += `\n\n**To advance to \`${primaryNext}\`**: spawn one of these agents: ${primaryHints.join(', ')}. The phase transition happens automatically when the agent starts.`;
        }
      }

      // Show remaining phases after current with mandatory warning
      const remainingPhases = workflow.phases.slice(currentIndex + 1);
      if (remainingPhases.length > 0) {
        const remainingNames = remainingPhases.map((p) => p.name).join(' → ');
        result += `\n\n**Remaining phases**: ${remainingNames}`;
        result += `\n\n⚠ You MUST complete all remaining phases before finishing.\n`;
        remainingPhases.forEach((p) => {
          const hints = p.agent_hints ?? [];
          result += `\n**To advance to \`${p.name}\`**: spawn one of these agents: ${hints.length > 0 ? hints.join(', ') : '(see phase context)'}. The phase transition happens automatically when the agent starts.`;
        });
      }
    }
  }

  return result;
}
