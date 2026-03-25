import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { WORKFLOWS_DIR } from './config.js';
import { log } from './logger.js';
import type { WorkflowConfig } from './workflow-config.js';
import { loadWorkflow, evaluateToolRule } from './workflow-config.js';

// ---- Types ----

export type WorkflowPhase = 'idle' | 'design' | 'plan' | 'execute' | 'test' | 'review' | 'complete';

export interface TransitionRecord {
  from: string;
  to: string;
  timestamp: string;
  trigger: string;
}

export interface WorkflowState {
  phase: string;
  workflowName: string;
  transitions: TransitionRecord[];
  sessionId: string;
  createdAt: string;
}

export interface PhaseEnforcementResult {
  action: 'allow' | 'warn' | 'block';
  message?: string;
}

// ---- Constants ----

const VALID_TRANSITIONS: Record<WorkflowPhase, WorkflowPhase[]> = {
  idle: ['design', 'plan', 'execute'],
  design: ['plan', 'execute'],
  plan: ['execute'],
  execute: ['test', 'review'],
  test: ['review', 'execute'],
  review: ['complete', 'execute'],
  complete: ['idle'],
};


// ---- Helpers ----

function sanitizeId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
}

function getStatePath(sessionId: string): string {
  return path.join(WORKFLOWS_DIR, sanitizeId(sessionId) + '.json');
}

function createDefaultState(sessionId: string, workflowName: string = 'default'): WorkflowState {
  // Load workflow config to get default_phase
  let defaultPhase = 'idle';
  if (workflowName) {
    try {
      const workflowConfig = loadWorkflow(workflowName);
      if (workflowConfig?.default_phase) {
        defaultPhase = workflowConfig.default_phase;
      }
    } catch (error) {
      log.warn('Failed to load workflow config for default phase, using idle', {
        sessionId,
        workflowName,
        error: String(error)
      });
    }
  }

  return {
    phase: defaultPhase,
    workflowName,
    transitions: [],
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

// ---- Public API ----

export function getWorkflowState(sessionId: string, workflowName?: string): WorkflowState {
  const statePath = getStatePath(sessionId);
  if (!existsSync(statePath)) {
    const newState = createDefaultState(sessionId, workflowName);
    // Persist the initial state
    try {
      writeFileSync(statePath, JSON.stringify(newState, null, 2), 'utf-8');
      log.debug('Initial workflow state created', {
        sessionId,
        workflowName: newState.workflowName,
        phase: newState.phase
      });
    } catch (error) {
      log.warn('Failed to persist initial workflow state', { sessionId, error: String(error) });
    }
    return newState;
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content) as WorkflowState;

    // Migration: add workflowName if missing
    if (!state.workflowName) {
      state.workflowName = workflowName ?? 'default';
    }

    return state;
  } catch (error) {
    log.error('Failed to read workflow state', { sessionId, error: String(error) });
    return createDefaultState(sessionId, workflowName);
  }
}

export function transitionPhase(
  sessionId: string,
  toPhase: string,
  trigger: string
): WorkflowState | null {
  const currentState = getWorkflowState(sessionId);
  const validTargets = VALID_TRANSITIONS[currentState.phase as WorkflowPhase] ?? [];

  if (!validTargets.includes(toPhase as WorkflowPhase)) {
    log.warn('Invalid workflow transition', {
      sessionId,
      from: currentState.phase,
      to: toPhase,
      trigger,
    });
    return null;
  }

  const newTransition: TransitionRecord = {
    from: currentState.phase,
    to: toPhase,
    timestamp: new Date().toISOString(),
    trigger,
  };

  const newState: WorkflowState = {
    ...currentState,
    phase: toPhase,
    transitions: [...currentState.transitions, newTransition],
  };

  try {
    writeFileSync(getStatePath(sessionId), JSON.stringify(newState, null, 2), 'utf-8');
    log.info('Workflow transitioned', {
      sessionId,
      from: currentState.phase,
      to: toPhase,
      trigger,
    });
    return newState;
  } catch (error) {
    log.error('Failed to write workflow state', { sessionId, error: String(error) });
    return null;
  }
}

export function skipToPhase(sessionId: string, toPhase: string): WorkflowState | null {
  const currentState = getWorkflowState(sessionId);

  const newTransition: TransitionRecord = {
    from: currentState.phase,
    to: toPhase,
    timestamp: new Date().toISOString(),
    trigger: 'manual_skip',
  };

  const newState: WorkflowState = {
    ...currentState,
    phase: toPhase,
    transitions: [...currentState.transitions, newTransition],
  };

  try {
    writeFileSync(getStatePath(sessionId), JSON.stringify(newState, null, 2), 'utf-8');
    log.info('Workflow skipped to phase', {
      sessionId,
      from: currentState.phase,
      to: toPhase,
    });
    return newState;
  } catch (error) {
    log.error('Failed to write workflow state', { sessionId, error: String(error) });
    return null;
  }
}

export function evaluatePreToolUse(
  phase: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  workflow: WorkflowConfig | null = null
): PhaseEnforcementResult {
  // Platform-level: always block native Plan Mode
  if (toolName === 'EnterPlanMode') {
    return {
      action: 'block',
      message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
    };
  }

  // Workflow-based evaluation
  if (workflow) {
    const phaseConfig = workflow.phases.find(p => p.name === phase);
    if (!phaseConfig || !phaseConfig.tool_rules) {
      return { action: 'allow' };
    }

    for (const rule of phaseConfig.tool_rules) {
      if (rule.tool_name === toolName) {
        const ruleMatches = evaluateToolRule(rule, toolInput);
        if (ruleMatches) {
          return {
            action: rule.action,
            message: rule.message,
          };
        }
      }
    }
  }

  return { action: 'allow' };
}


export function getPhaseContext(phase: string, workflow: WorkflowConfig | null = null): string | null {
  if (workflow) {
    const phaseConfig = workflow.phases.find(p => p.name === phase);
    return phaseConfig?.context ?? null;
  }
  return null;
}

export function inferPhaseFromAgent(agentType: string, workflow: WorkflowConfig | null = null): string | null {
  if (workflow) {
    for (const phase of workflow.phases) {
      if (phase.agent_hints?.includes(agentType)) {
        return phase.name;
      }
    }
  }
  return null;
}

export function resetWorkflow(sessionId: string, workflowName?: string): WorkflowState | null {
  const newState = createDefaultState(sessionId, workflowName);
  try {
    writeFileSync(getStatePath(sessionId), JSON.stringify(newState, null, 2), 'utf-8');
    log.info('Workflow reset', { sessionId });
    return newState;
  } catch (error) {
    log.error('Failed to reset workflow state', { sessionId, error: String(error) });
    return null;
  }
}
