import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { WORKFLOWS_DIR } from './config.js';
import { log } from './logger.js';

// ---- Types ----

export type WorkflowPhase = 'idle' | 'design' | 'plan' | 'execute' | 'test' | 'review' | 'complete';

export interface TransitionRecord {
  from: WorkflowPhase;
  to: WorkflowPhase;
  timestamp: string;
  trigger: string;
}

export interface WorkflowState {
  phase: WorkflowPhase;
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

const PHASE_CONTEXT: Record<WorkflowPhase, string | null> = {
  idle: null,
  design: 'WORKFLOW PHASE: DESIGN. Focus on understanding requirements and exploring approaches. Do not write implementation code.',
  plan: 'WORKFLOW PHASE: PLAN. Create a detailed implementation plan. Do not write implementation code yet.',
  execute: 'WORKFLOW PHASE: EXECUTE. Implement according to the plan.',
  test: 'WORKFLOW PHASE: TEST. Write and run tests for the implementation.',
  review: 'WORKFLOW PHASE: REVIEW. Review code for spec compliance and quality.',
  complete: null,
};

// ---- Helpers ----

function sanitizeId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
}

function getStatePath(sessionId: string): string {
  return path.join(WORKFLOWS_DIR, sanitizeId(sessionId) + '.json');
}

function createDefaultState(sessionId: string): WorkflowState {
  return {
    phase: 'idle',
    transitions: [],
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

// ---- Public API ----

export function getWorkflowState(sessionId: string): WorkflowState {
  const statePath = getStatePath(sessionId);
  if (!existsSync(statePath)) {
    return createDefaultState(sessionId);
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    return JSON.parse(content) as WorkflowState;
  } catch (error) {
    log.error('Failed to read workflow state', { sessionId, error: String(error) });
    return createDefaultState(sessionId);
  }
}

export function transitionPhase(
  sessionId: string,
  toPhase: WorkflowPhase,
  trigger: string
): WorkflowState | null {
  const currentState = getWorkflowState(sessionId);
  const validTargets = VALID_TRANSITIONS[currentState.phase];

  if (!validTargets.includes(toPhase)) {
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

export function skipToPhase(sessionId: string, toPhase: WorkflowPhase): WorkflowState | null {
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
  phase: WorkflowPhase,
  toolName: string,
  toolInput: Record<string, unknown>
): PhaseEnforcementResult {
  const filePath = (toolInput.file_path as string) ?? '';

  switch (phase) {
    case 'design':
      if (toolName === 'Edit' || toolName === 'Write') {
        return {
          action: 'warn',
          message: 'Design phase: consider finalizing your design before writing code',
        };
      }
      break;

    case 'plan':
      if (toolName === 'Edit' || toolName === 'Write') {
        if (!filePath.includes('plan') && !filePath.includes('doc')) {
          return {
            action: 'warn',
            message: 'Plan phase: implementation should wait until planning is complete',
          };
        }
      }
      break;

    case 'test':
      if (toolName === 'Edit' || toolName === 'Write') {
        if (
          !filePath.includes('test') &&
          !filePath.includes('spec') &&
          !filePath.includes('__tests__')
        ) {
          return {
            action: 'warn',
            message: 'Test phase: focus on writing tests, not implementation changes',
          };
        }
      }
      break;

    case 'review':
      if (toolName === 'Bash') {
        const command = (toolInput.command as string) ?? '';
        if (command.includes('git commit')) {
          return {
            action: 'block',
            message: 'Cannot commit during review phase. Wait for review to complete.',
          };
        }
      }
      break;

    case 'idle':
    case 'execute':
    case 'complete':
    default:
      break;
  }

  return { action: 'allow' };
}

export function getPhaseContext(phase: WorkflowPhase): string | null {
  return PHASE_CONTEXT[phase];
}

export function inferPhaseFromAgent(agentType: string): WorkflowPhase | null {
  switch (agentType) {
    case 'planner':
    case 'architect':
      return 'plan';

    case 'code_agent':
    case 'frontend-agent':
    case 'build-error-resolver':
    case 'debugger':
      return 'execute';

    case 'tdd-guide':
    case 'e2e-runner':
      return 'test';

    case 'code-reviewer':
    case 'security-reviewer':
      return 'review';

    default:
      return null;
  }
}

export function resetWorkflow(sessionId: string): WorkflowState | null {
  const newState = createDefaultState(sessionId);
  try {
    writeFileSync(getStatePath(sessionId), JSON.stringify(newState, null, 2), 'utf-8');
    log.info('Workflow reset', { sessionId });
    return newState;
  } catch (error) {
    log.error('Failed to reset workflow state', { sessionId, error: String(error) });
    return null;
  }
}
