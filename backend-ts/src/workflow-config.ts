import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { log } from './logger.js';

// ---- Types ----

export interface ToolRuleCondition {
  file_path_excludes?: string[];  // Paths that should NOT match (e.g., ['test', 'spec', '__tests__'])
  command_contains?: string[];    // Bash commands that should NOT match
}

export interface ToolRule {
  tool_name?: string;             // Tool name to match (e.g., 'Edit', 'Write', 'Bash') - HEAD version
  tool?: string;                  // Tool name (cherry-pick version, for compatibility)
  action: 'allow' | 'warn' | 'block';
  condition?: string;             // Cherry-pick version condition string
  message?: string;               // Message to show when rule triggers
  conditions?: ToolRuleCondition; // Additional conditions to check (HEAD version)
}

export interface WorkflowPhaseConfig {
  name: string;
  context?: string;               // Phase context injected into system prompt
  tool_rules?: ToolRule[];        // Tool enforcement rules (internal snake_case format)
  agent_hints?: string[];         // Agent types (internal snake_case format)
}

export interface WorkflowTransition {
  from: string;
  to: string[] | string;          // Valid target phases - support both array and string
}

export interface WorkflowConfig {
  name: string;
  description?: string;
  builtin?: boolean;
  phases: WorkflowPhaseConfig[];
  transitions: WorkflowTransition[];
}

// ---- Storage ----

// User-level workflow config directory: ~/.ccplus/workflows/
const WORKFLOW_CONFIGS_DIR = path.join(homedir(), '.ccplus', 'workflows');

function ensureDir(): void {
  if (!existsSync(WORKFLOW_CONFIGS_DIR)) {
    mkdirSync(WORKFLOW_CONFIGS_DIR, { recursive: true });
  }
}

function sanitizeName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error(`Workflow name "${name}" contains no valid characters`);
  return safe;
}

function getWorkflowPath(name: string): string {
  return path.join(WORKFLOW_CONFIGS_DIR, `${sanitizeName(name)}.json`);
}

// ---- Built-in Workflows ----

/**
 * DEFAULT_WORKFLOW - Exact replica of current hardcoded behavior
 * This ensures zero behavior change for existing users
 */
export const DEFAULT_WORKFLOW: WorkflowConfig = {
  name: 'default',
  phases: [
    {
      name: 'idle',
      context: undefined,
      agent_hints: [],
      tool_rules: [
        {
          tool_name: 'EnterPlanMode',
          action: 'block',
          message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
        },
        {
          tool_name: 'Edit',
          action: 'block',
          message: 'Idle phase: spawn a planner agent before writing code. Use Agent tool with subagent_type "planner".',
          conditions: {
            file_path_excludes: ['plan', 'doc', 'README', '.env', 'config', 'memory', '.claude/', '.gitignore', 'SKILL'],
          },
        },
        {
          tool_name: 'Write',
          action: 'block',
          message: 'Idle phase: spawn a planner agent before writing code. Use Agent tool with subagent_type "planner".',
          conditions: {
            file_path_excludes: ['plan', 'doc', 'README', '.env', 'config', 'memory', '.claude/', '.gitignore', 'SKILL'],
          },
        },
      ],
    },
    {
      name: 'design',
      agent_hints: [],
      context: `WORKFLOW PHASE: DESIGN
You are in the design phase. Your job is to understand requirements and explore approaches.

Rules:
- Do NOT write implementation code, scaffolding, or file changes
- Ask clarifying questions to understand the full scope
- List 2-3 alternative approaches with trade-offs for each
- Identify the riskiest assumption in the preferred approach
- Present your design for user approval before proceeding

If you catch yourself writing code: STOP. Delete it. Return to design exploration.
The terminal state of this phase is an approved design direction, not code.`,
      tool_rules: [
        {
          tool_name: 'EnterPlanMode',
          action: 'block',
          message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
        },
        {
          tool_name: 'Edit',
          action: 'warn',
          message: 'Design phase: consider finalizing your design before writing code',
        },
        {
          tool_name: 'Write',
          action: 'warn',
          message: 'Design phase: consider finalizing your design before writing code',
        },
      ],
    },
    {
      name: 'plan',
      agent_hints: ['planner', 'architect'],
      context: `WORKFLOW PHASE: PLAN
You are in the planning phase. Your job is to create a detailed, actionable implementation plan.

Rules:
- Do NOT write implementation code yet
- Each step must be completable in 2-5 minutes
- Every step needs: exact file path, function/class name, shell command to verify
- Write assuming "zero context" — someone unfamiliar with the codebase should follow without asking
- Include a testing strategy with specific test files and cases
- Break large features into independently deliverable phases

If the plan has steps without file paths or verification commands, it is not detailed enough.`,
      tool_rules: [
        {
          tool_name: 'EnterPlanMode',
          action: 'block',
          message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
        },
        {
          tool_name: 'Edit',
          action: 'warn',
          message: 'Plan phase: implementation should wait until planning is complete',
          conditions: {
            file_path_excludes: ['plan', 'doc'],
          },
        },
        {
          tool_name: 'Write',
          action: 'warn',
          message: 'Plan phase: implementation should wait until planning is complete',
          conditions: {
            file_path_excludes: ['plan', 'doc'],
          },
        },
      ],
    },
    {
      name: 'execute',
      agent_hints: ['code_agent', 'frontend-agent', 'build-error-resolver', 'debugger'],
      context: `WORKFLOW PHASE: EXECUTE
You are in the execution phase. Implement according to the approved plan.

Rules:
- Follow the plan step by step — do not skip ahead or reorder without reason
- If you hit a blocker, report it rather than improvising a workaround
- Write the smallest reasonable implementation for each step
- Do not refactor surrounding code or add features not in the plan
- After completing implementation, transition to testing`,
      tool_rules: [
        {
          tool_name: 'EnterPlanMode',
          action: 'block',
          message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
        },
      ],
    },
    {
      name: 'test',
      agent_hints: ['tdd-guide', 'e2e-runner'],
      context: `WORKFLOW PHASE: TEST
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
      tool_rules: [
        {
          tool_name: 'EnterPlanMode',
          action: 'block',
          message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
        },
        {
          tool_name: 'Edit',
          action: 'warn',
          message: 'Test phase: focus on writing tests, not implementation changes',
          conditions: {
            file_path_excludes: ['test', 'spec', '__tests__'],
          },
        },
        {
          tool_name: 'Write',
          action: 'warn',
          message: 'Test phase: focus on writing tests, not implementation changes',
          conditions: {
            file_path_excludes: ['test', 'spec', '__tests__'],
          },
        },
      ],
    },
    {
      name: 'review',
      agent_hints: ['code-reviewer', 'security-reviewer'],
      context: `WORKFLOW PHASE: REVIEW
You are in the review phase. Review code for spec compliance and quality.

Rules:
- Stage 1: Does the code implement what was asked? If not, BLOCK immediately
- Stage 2: Check security, quality, performance, immutability, error handling
- Every finding must reference a specific file:line with an explanation of WHY
- Do NOT commit during review — commits are blocked until review completes
- Banned words in findings: "should", "probably", "seems to", "might"

Anti-sycophancy: If the implementer disagrees with a finding, re-examine the code.
Do not reverse findings to be agreeable. Your job is accuracy, not agreement.`,
      tool_rules: [
        {
          tool_name: 'EnterPlanMode',
          action: 'block',
          message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
        },
        {
          tool_name: 'Bash',
          action: 'block',
          message: 'Cannot commit during review phase. Wait for review to complete.',
          conditions: {
            command_contains: ['git commit'],
          },
        },
      ],
    },
    {
      name: 'complete',
      context: undefined,
      tool_rules: [
        {
          tool_name: 'EnterPlanMode',
          action: 'block',
          message: 'EnterPlanMode is disabled. Use Agent tool with subagent_type "planner" instead.',
        },
      ],
    },
  ],
  transitions: [
    { from: 'idle', to: ['design', 'plan', 'execute'] },
    { from: 'design', to: ['plan', 'execute'] },
    { from: 'plan', to: ['execute'] },
    { from: 'execute', to: ['test', 'review'] },
    { from: 'test', to: ['review', 'execute'] },
    { from: 'review', to: ['complete', 'execute'] },
    { from: 'complete', to: ['idle'] },
  ],
};

/**
 * FEATURE_WORKFLOW - For new features (design -> plan -> execute -> test -> review)
 */
export const FEATURE_WORKFLOW: WorkflowConfig = {
  name: 'feature',
  phases: DEFAULT_WORKFLOW.phases, // Reuse default phases
  transitions: DEFAULT_WORKFLOW.transitions,
};

/**
 * DEBUG_WORKFLOW - For debugging (idle -> execute -> test)
 * Skips planning and review phases for quick iteration
 */
export const DEBUG_WORKFLOW: WorkflowConfig = {
  name: 'debug',
  phases: [
    { name: 'idle', tool_rules: [] },
    {
      name: 'execute',
      agent_hints: ['debugger', 'code_agent'],
      context: `WORKFLOW PHASE: DEBUG
You are debugging an issue. Focus on reproduction and root cause analysis.

Rules:
- Reproduce the issue first
- Use debugger tools and logs to understand the problem
- Test the fix before marking complete`,
      tool_rules: [],
    },
    {
      name: 'test',
      agent_hints: ['tdd-guide'],
      context: DEFAULT_WORKFLOW.phases.find(p => p.name === 'test')?.context,
      tool_rules: [],
    },
  ],
  transitions: [
    { from: 'idle', to: ['execute'] },
    { from: 'execute', to: ['test'] },
    { from: 'test', to: ['execute', 'idle'] },
  ],
};

/**
 * TDD_WORKFLOW - For test-driven development (test -> execute loop)
 */
export const TDD_WORKFLOW: WorkflowConfig = {
  name: 'tdd',
  phases: [
    { name: 'idle', tool_rules: [] },
    {
      name: 'test',
      agent_hints: ['tdd-guide'],
      context: `WORKFLOW PHASE: TDD (RED)
Write a failing test first.

Rules:
- Write ONE test that describes the behavior you want
- Run it and watch it FAIL
- Only then move to implementation`,
      tool_rules: [],
    },
    {
      name: 'execute',
      agent_hints: ['code_agent', 'frontend-agent'],
      context: `WORKFLOW PHASE: TDD (GREEN)
Make the test pass with minimal code.

Rules:
- Write just enough code to pass the test
- Run the test again and watch it PASS
- Then refactor if needed`,
      tool_rules: [],
    },
  ],
  transitions: [
    { from: 'idle', to: ['test'] },
    { from: 'test', to: ['execute'] },
    { from: 'execute', to: ['test', 'idle'] },
  ],
};

/**
 * HOTFIX_WORKFLOW - For urgent fixes (execute -> review -> complete)
 * Minimal workflow for production hotfixes
 */
export const HOTFIX_WORKFLOW: WorkflowConfig = {
  name: 'hotfix',
  phases: [
    { name: 'idle', tool_rules: [] },
    {
      name: 'execute',
      agent_hints: ['code_agent', 'debugger'],
      context: `WORKFLOW PHASE: HOTFIX
You are applying an urgent production fix.

Rules:
- Fix ONLY the immediate issue
- Do NOT refactor or improve surrounding code
- Add a regression test
- Get code review before deploying`,
      tool_rules: [],
    },
    {
      name: 'review',
      agent_hints: ['code-reviewer', 'security-reviewer'],
      context: DEFAULT_WORKFLOW.phases.find(p => p.name === 'review')?.context,
      tool_rules: [
        {
          tool_name: 'Bash',
          action: 'block',
          message: 'Cannot commit during review phase. Wait for review to complete.',
          conditions: { command_contains: ['git commit'] },
        },
      ],
    },
    { name: 'complete', tool_rules: [] },
  ],
  transitions: [
    { from: 'idle', to: ['execute'] },
    { from: 'execute', to: ['review'] },
    { from: 'review', to: ['complete', 'execute'] },
    { from: 'complete', to: ['idle'] },
  ],
};

// ---- Workflow Cache ----

const workflowCache = new Map<string, WorkflowConfig>();

// ---- Public API ----

/**
 * Load a workflow by name with resolution order:
 * 1. Project-specific: <workspace>/.ccplus/workflows/<name>/workflow.yaml
 * 2. Global: ~/.ccplus/workflows/<name>/workflow.yaml
 * 3. Built-in constants
 */
export function loadWorkflow(name: string, workspace: string): WorkflowConfig {
  // Check cache first
  const cacheKey = `${workspace}:${name}`;
  if (workflowCache.has(cacheKey)) {
    return workflowCache.get(cacheKey)!;
  }

  // Try project-specific workflow
  const projectPath = path.join(workspace, '.ccplus', 'workflows', name, 'workflow.yaml');
  if (existsSync(projectPath)) {
    try {
      const config = loadWorkflowFromFile(projectPath);
      workflowCache.set(cacheKey, config);
      log.info('Loaded project workflow', { name, path: projectPath });
      return config;
    } catch (error) {
      log.error('Failed to load project workflow', { name, path: projectPath, error: String(error) });
      // Fall through to global/built-in
    }
  }

  // Try global workflow
  const globalPath = path.join(homedir(), '.ccplus', 'workflows', name, 'workflow.yaml');
  if (existsSync(globalPath)) {
    try {
      const config = loadWorkflowFromFile(globalPath);
      workflowCache.set(cacheKey, config);
      log.info('Loaded global workflow', { name, path: globalPath });
      return config;
    } catch (error) {
      log.error('Failed to load global workflow', { name, path: globalPath, error: String(error) });
      // Fall through to built-in
    }
  }

  // Try built-in workflows
  const builtIn = getBuiltInWorkflow(name);
  if (builtIn) {
    workflowCache.set(cacheKey, builtIn);
    return builtIn;
  }

  // Default to default workflow
  log.warn('Workflow not found, using default', { name });
  workflowCache.set(cacheKey, DEFAULT_WORKFLOW);
  return DEFAULT_WORKFLOW;
}

/**
 * List all available workflow names (built-in + global + project)
 */
export function listWorkflows(workspace: string): string[] {
  const workflows = new Set<string>();

  // Add built-in workflows
  workflows.add('default');
  workflows.add('feature');
  workflows.add('debug');
  workflows.add('tdd');
  workflows.add('hotfix');

  // Add global workflows
  const globalDir = path.join(homedir(), '.ccplus', 'workflows');
  if (existsSync(globalDir)) {
    try {
      const globalWorkflows = readDirectoryWorkflows(globalDir);
      globalWorkflows.forEach(w => workflows.add(w));
    } catch (error) {
      log.debug('Failed to read global workflows', { error: String(error) });
    }
  }

  // Add project workflows
  const projectDir = path.join(workspace, '.ccplus', 'workflows');
  if (existsSync(projectDir)) {
    try {
      const projectWorkflows = readDirectoryWorkflows(projectDir);
      projectWorkflows.forEach(w => workflows.add(w));
    } catch (error) {
      log.debug('Failed to read project workflows', { error: String(error) });
    }
  }

  return Array.from(workflows).sort();
}

/**
 * Get valid target phases from a given phase
 */
export function getValidTransitions(workflow: WorkflowConfig, fromPhase: string): string[] {
  const transition = workflow.transitions.find(t => t.from === fromPhase);
  if (!transition) return [];
  // Handle both array and string format for compatibility
  return Array.isArray(transition.to) ? transition.to : [transition.to];
}

/**
 * Get phase configuration by name
 */
export function getPhaseConfig(workflow: WorkflowConfig, phase: string): WorkflowPhaseConfig | null {
  return workflow.phases.find(p => p.name === phase) ?? null;
}

/**
 * Evaluate a tool rule against tool input
 */
export function evaluateToolRule(rule: ToolRule, toolInput: Record<string, unknown>): boolean {
  if (!rule.conditions) {
    return true; // No conditions = always matches
  }

  // Check file_path_excludes condition
  if (rule.conditions.file_path_excludes) {
    const filePath = (toolInput.file_path as string) ?? '';
    if (filePath) {
      const isExcluded = rule.conditions.file_path_excludes.some(pattern =>
        filePath.includes(pattern)
      );
      if (isExcluded) {
        return false; // File matches exclusion pattern, rule doesn't apply
      }
    }
  }

  // Check command_contains condition
  if (rule.conditions.command_contains) {
    const command = (toolInput.command as string) ?? '';
    if (command) {
      const containsPattern = rule.conditions.command_contains.some(pattern =>
        command.includes(pattern)
      );
      if (!containsPattern) {
        return false; // Command doesn't contain required pattern
      }
    }
  }

  return true; // All conditions passed
}

// ---- Private Helpers ----

function getBuiltInWorkflow(name: string): WorkflowConfig | null {
  switch (name) {
    case 'default':
      return DEFAULT_WORKFLOW;
    case 'feature':
      return FEATURE_WORKFLOW;
    case 'debug':
      return DEBUG_WORKFLOW;
    case 'tdd':
      return TDD_WORKFLOW;
    case 'hotfix':
      return HOTFIX_WORKFLOW;
    default:
      return null;
  }
}

function loadWorkflowFromFile(filePath: string): WorkflowConfig {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content) as WorkflowConfig;

  // Validate basic structure
  if (!parsed.name || !parsed.phases || !parsed.transitions) {
    throw new Error('Invalid workflow YAML: missing required fields (name, phases, transitions)');
  }

  return parsed;
}

function readDirectoryWorkflows(dir: string): string[] {
  try {
    const entries = readdirSync(dir);
    const workflows: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      const stats = require('fs').statSync(entryPath);
      if (stats.isDirectory()) {
        const yamlPath = path.join(entryPath, 'workflow.yaml');
        if (existsSync(yamlPath)) {
          workflows.push(entry);
        }
      }
    }

    return workflows;
  } catch (error) {
    return [];
  }
}

// ---- Additional API for workflow builder (cherry-pick additions) ----

/**
 * Get workflow by name (supports both built-in and user workflows)
 */
export function getWorkflowByName(name: string, workspace: string): WorkflowConfig | null {
  const workflow = loadWorkflow(name, workspace);
  return workflow;
}

/**
 * Save a user workflow to JSON format (for workflow builder)
 */
export function saveWorkflow(workflow: WorkflowConfig): string {
  if (!workflow.name?.trim()) {
    throw new Error('Workflow name is required');
  }
  const safeName = sanitizeName(workflow.name);
  ensureDir();
  const toSave: WorkflowConfig = { ...workflow, builtin: false, name: safeName };
  writeFileSync(getWorkflowPath(safeName), JSON.stringify(toSave, null, 2), 'utf-8');
  log.info('Saved workflow config', { name: safeName });
  return safeName;
}

/**
 * Delete a user workflow (cannot delete built-in workflows)
 */
export function deleteWorkflow(name: string): boolean {
  const wfPath = getWorkflowPath(name);
  if (!existsSync(wfPath)) return false;
  try {
    rmSync(wfPath);
    log.info('Deleted workflow config', { name });
    return true;
  } catch (error) {
    log.error('Failed to delete workflow', { name, error: String(error) });
    return false;
  }
}

/**
 * Load user workflows from JSON files
 */
function loadUserWorkflows(): WorkflowConfig[] {
  ensureDir();
  try {
    return readdirSync(WORKFLOW_CONFIGS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const content = readFileSync(path.join(WORKFLOW_CONFIGS_DIR, f), 'utf-8');
          return JSON.parse(content) as WorkflowConfig;
        } catch {
          return null;
        }
      })
      .filter((w): w is WorkflowConfig => w !== null && typeof w.name === 'string');
  } catch {
    return [];
  }
}

/**
 * Load a single user workflow from JSON
 */
function loadUserWorkflow(name: string): WorkflowConfig | null {
  const wfPath = getWorkflowPath(name);
  if (!existsSync(wfPath)) return null;
  try {
    const content = readFileSync(wfPath, 'utf-8');
    return JSON.parse(content) as WorkflowConfig;
  } catch {
    return null;
  }
}
