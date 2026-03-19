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
  design: `WORKFLOW PHASE: DESIGN
You are in the design phase. Your job is to understand requirements and explore approaches.

Rules:
- Do NOT write implementation code, scaffolding, or file changes
- Ask clarifying questions to understand the full scope
- List 2-3 alternative approaches with trade-offs for each
- Identify the riskiest assumption in the preferred approach
- Present your design for user approval before proceeding

If you catch yourself writing code: STOP. Delete it. Return to design exploration.
The terminal state of this phase is an approved design direction, not code.`,

  plan: `WORKFLOW PHASE: PLAN
You are in the planning phase. Your job is to create a detailed, actionable implementation plan.

Rules:
- Do NOT write implementation code yet
- Each step must be completable in 2-5 minutes
- Every step needs: exact file path, function/class name, shell command to verify
- Write assuming "zero context" — someone unfamiliar with the codebase should follow without asking
- Include a testing strategy with specific test files and cases
- Break large features into independently deliverable phases

If the plan has steps without file paths or verification commands, it is not detailed enough.`,

  execute: `WORKFLOW PHASE: EXECUTE
You are in the execution phase. Implement according to the approved plan.

Rules:
- Follow the plan step by step — do not skip ahead or reorder without reason
- If you hit a blocker, report it rather than improvising a workaround
- Write the smallest reasonable implementation for each step
- Do not refactor surrounding code or add features not in the plan
- After completing implementation, transition to testing`,

  test: `WORKFLOW PHASE: TEST
You are in the testing phase. Write and run tests for the implementation.

Rules:
- Write failing tests FIRST (Red), then verify they pass with the implementation (Green)
- Test behavior, not implementation details
- Cover: happy path, error paths, edge cases (null, empty, boundary values)
- For bug fixes: show the test FAILS without the fix AND PASSES with the fix
- Run the full test suite and show actual output — never say "tests should pass"
- Target 80%+ coverage on new code

| Excuse | Rebuttal |
|--------|----------|
| "The code already works" | Then the test will pass immediately. Write it |
| "It's just a config change" | Config errors are the hardest to debug. Test it |
| "I'll add tests later" | You won't. Write them now |`,

  review: `WORKFLOW PHASE: REVIEW
You are in the review phase. Review code for spec compliance and quality.

Rules:
- Stage 1: Does the code implement what was asked? If not, BLOCK immediately
- Stage 2: Check security, quality, performance, immutability, error handling
- Every finding must reference a specific file:line with an explanation of WHY
- Do NOT commit during review — commits are blocked until review completes
- Banned words in findings: "should", "probably", "seems to", "might"

Anti-sycophancy: If the implementer disagrees with a finding, re-examine the code.
Do not reverse findings to be agreeable. Your job is accuracy, not agreement.`,

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

  // Block native Plan Mode in all phases — always use planner agent instead
  if (toolName === 'EnterPlanMode') {
    return {
      action: 'block',
      message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
    };
  }

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
      if (toolName === 'Edit' || toolName === 'Write') {
        const isSourceFile = filePath &&
          !filePath.includes('plan') &&
          !filePath.includes('doc') &&
          !filePath.includes('README') &&
          !filePath.includes('.env') &&
          !filePath.includes('config');
        if (isSourceFile) {
          return {
            action: 'block',
            message: 'Idle phase: spawn a planner agent before writing code. Use Agent tool with subagent_type "planner".',
          };
        }
      }
      break;

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
