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

Use the Agent tool to delegate work to these specialized agents:

| Agent | Description | Model | Tool Restrictions |
|-------|-------------|-------|-------------------|
${rows.join('\n')}

**Delegation rules:**
- For non-trivial tasks (>1 file), ALWAYS delegate to the appropriate agent
- You are a DELEGATOR — your primary tool is the Agent tool
- Direct work is only for targeted single-file edits or quick fixes
- When delegating, specify: exact files, acceptance criteria, constraints, and context`;
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
  if (!workflow || !workflow.phases || workflow.phases.length === 0) {
    return '';
  }

  const workflowName = workflow.name || 'unknown';
  const phaseSequence = workflow.phases.map((p) => p.name).join(' → ');

  let result = `## Active Workflow: ${workflowName}

**Phases**: ${phaseSequence}`;

  if (currentPhase) {
    const phase = workflow.phases.find((p) => p.name === currentPhase);

    if (phase) {
      result += `\n\n### Current Phase: ${currentPhase}`;

      if (phase.context) {
        result += `\n\n${phase.context}`;
      }

      const validTransitions = workflow.transitions
        .filter((t) => t.from === currentPhase)
        .map((t) => t.to);

      if (validTransitions.length > 0) {
        result += `\n\n### Valid Transitions from ${currentPhase}`;
        validTransitions.forEach((to) => {
          result += `\n- ${to}`;
        });
      }
    }
  }

  return result;
}
