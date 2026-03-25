import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { PROJECT_ROOT } from './config.js';
import { log } from './logger.js';
import * as workflowDb from './db/workflows.js';

// ---- TypeScript Interfaces ----

export interface ToolRule {
  tool_name: string;
  action: 'allow' | 'warn' | 'block';
  conditions: string[];
  message?: string;
}

export interface WorkflowPhaseConfig {
  name: string;
  context: string;
  agent_hints: string[];
  tool_rules: ToolRule[];
}

export interface WorkflowTransition {
  from: string;
  to: string;
}

export interface WorkflowConfig {
  name: string;
  description: string;
  default_phase: string;
  phases: WorkflowPhaseConfig[];
  transitions: WorkflowTransition[];
  worktree?: boolean;
  builtin?: boolean;
}

// ---- Helper Functions ----

function parseYamlWorkflow(yamlContent: string): WorkflowConfig {
  const raw = yaml.load(yamlContent);
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid workflow YAML: file is empty or not a mapping');
  }
  const parsed = raw as Partial<WorkflowConfig>;

  // Validate required fields
  if (!parsed.name || !parsed.description || !parsed.default_phase || !parsed.phases || !parsed.transitions) {
    throw new Error('Invalid workflow YAML: missing required fields (name, description, default_phase, phases, transitions)');
  }

  // Validate phases have required fields
  for (const phase of parsed.phases) {
    if (!phase.name || !phase.context || !phase.agent_hints || !phase.tool_rules) {
      throw new Error(`Invalid phase in workflow: missing required fields (name, context, agent_hints, tool_rules)`);
    }
  }

  // Validate transitions have required fields
  for (const transition of parsed.transitions) {
    if (!transition.from || !transition.to) {
      throw new Error(`Invalid transition in workflow: missing required fields (from, to)`);
    }
  }

  return parsed as WorkflowConfig;
}

function isPathSafe(resolvedPath: string, baseDir: string): boolean {
  const normalizedBase = path.resolve(baseDir) + path.sep;
  return path.resolve(resolvedPath).startsWith(normalizedBase);
}

function findWorkflowYaml(workflowName: string): string | null {
  // Check project-local .ccplus/workflows/ first
  const projectWorkflowsBase = path.join(PROJECT_ROOT, '.ccplus', 'workflows');
  const projectWorkflowPath = path.join(projectWorkflowsBase, workflowName, 'workflow.yaml');
  if (!isPathSafe(projectWorkflowPath, projectWorkflowsBase)) {
    throw new Error(`Invalid workflow name: ${workflowName}`);
  }
  if (existsSync(projectWorkflowPath)) {
    return projectWorkflowPath;
  }

  // Check global ~/.ccplus/workflows/
  const globalWorkflowsBase = path.join(homedir(), '.ccplus', 'workflows');
  const globalWorkflowPath = path.join(globalWorkflowsBase, workflowName, 'workflow.yaml');
  if (!isPathSafe(globalWorkflowPath, globalWorkflowsBase)) {
    throw new Error(`Invalid workflow name: ${workflowName}`);
  }
  if (existsSync(globalWorkflowPath)) {
    return globalWorkflowPath;
  }

  return null;
}

// ---- Private Filesystem API (for seeding) ----

function loadWorkflowFromYaml(workflowName: string): WorkflowConfig {
  const yamlPath = findWorkflowYaml(workflowName);

  if (!yamlPath) {
    throw new Error(`Workflow not found: ${workflowName}. Expected workflow.yaml in .ccplus/workflows/${workflowName}/ or ~/.ccplus/workflows/${workflowName}/`);
  }

  return loadWorkflowFromPath(yamlPath);
}

function loadWorkflowFromPath(yamlPath: string): WorkflowConfig {
  try {
    const yamlContent = readFileSync(yamlPath, 'utf-8');
    const workflow = parseYamlWorkflow(yamlContent);
    log.info('Loaded workflow from YAML', { name: workflow.name, path: yamlPath });
    return workflow;
  } catch (error) {
    log.error('Failed to load workflow', { path: yamlPath, error: String(error) });
    throw new Error(`Failed to load workflow from ${yamlPath}: ${error}`);
  }
}

function listWorkflowsFromYaml(): string[] {
  const workflows = new Set<string>();

  // List project-local workflows
  const projectWorkflowsDir = path.join(PROJECT_ROOT, '.ccplus', 'workflows');
  if (existsSync(projectWorkflowsDir)) {
    try {
      const entries = readdirSync(projectWorkflowsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const yamlPath = path.join(projectWorkflowsDir, entry.name, 'workflow.yaml');
          if (existsSync(yamlPath)) {
            workflows.add(entry.name);
          }
        }
      }
    } catch (error) {
      log.error('Failed to list project workflows', { error: String(error) });
    }
  }

  // List global workflows
  const globalWorkflowsDir = path.join(homedir(), '.ccplus', 'workflows');
  if (existsSync(globalWorkflowsDir)) {
    try {
      const entries = readdirSync(globalWorkflowsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const yamlPath = path.join(globalWorkflowsDir, entry.name, 'workflow.yaml');
          if (existsSync(yamlPath)) {
            workflows.add(entry.name);
          }
        }
      }
    } catch (error) {
      log.error('Failed to list global workflows', { error: String(error) });
    }
  }

  return Array.from(workflows).sort();
}

// ---- Public DB-backed API ----

export function seedWorkflows(): void {
  try {
    const yamlWorkflowNames = listWorkflowsFromYaml();
    let seededCount = 0;

    for (const name of yamlWorkflowNames) {
      try {
        // Load from YAML and upsert (always load from YAML)
        const workflow = loadWorkflowFromYaml(name);
        workflowDb.upsertWorkflow(workflow, true);
        seededCount++;
        log.info('Seeded workflow from YAML', { name });
      } catch (error) {
        log.error('Failed to seed workflow', { name, error: String(error) });
      }
    }

    if (seededCount > 0) {
      log.info('Seeded workflows from YAML files', { count: seededCount });
    }
  } catch (error) {
    // Gracefully handle seeding failures (e.g., in test environments with mocked database)
    log.warn('Failed to seed workflows', { error: String(error) });
  }
}

export function loadWorkflow(workflowName: string, _workspace?: string): WorkflowConfig {
  const workflow = workflowDb.getWorkflowByName(workflowName);

  if (!workflow) {
    // If workflow not found by name, try to load 'default' as fallback
    if (workflowName !== 'default') {
      log.warn('Workflow not found, falling back to default', { workflowName });
      const defaultWorkflow = workflowDb.getWorkflowByName('default');
      if (!defaultWorkflow) {
        throw new Error('Default workflow not found in database');
      }
      return defaultWorkflow;
    }
    throw new Error(`Workflow not found: ${workflowName}`);
  }

  return workflow;
}

export function getWorkflowByName(workflowName: string, _workspace?: string): WorkflowConfig | null {
  return workflowDb.getWorkflowByName(workflowName);
}

export function listWorkflows(_workspace?: string): string[] {
  const workflows = workflowDb.getAllWorkflows();
  return workflows.map((w) => w.name).sort();
}

/**
 * Evaluate if a tool rule matches based on its conditions.
 * Returns true if the rule should be applied (all conditions match).
 */
export function evaluateToolRule(rule: ToolRule, toolInput: Record<string, unknown>): boolean {
  // If conditions array is empty, rule always matches
  if (!rule.conditions || rule.conditions.length === 0) {
    return true;
  }

  // All conditions must match (AND logic)
  for (const condition of rule.conditions) {
    if (condition.startsWith('command_contains:')) {
      const pattern = condition.substring('command_contains:'.length);
      const command = toolInput.command;
      if (typeof command !== 'string' || !command.includes(pattern)) {
        return false;
      }
    } else if (condition.startsWith('file_path_not_contains:')) {
      const patternsStr = condition.substring('file_path_not_contains:'.length);
      const patterns = patternsStr.split(',').map(p => p.trim());
      const filePath = toolInput.file_path;

      if (typeof filePath !== 'string') {
        return false;
      }

      // Rule MATCHES (returns true) when file path does NOT contain any of the patterns
      for (const pattern of patterns) {
        if (filePath.includes(pattern)) {
          return false;
        }
      }
    } else {
      // Unknown condition type - log warning and treat as non-matching
      log.warn('Unknown condition type in tool rule', {
        condition,
        toolName: rule.tool_name
      });
      return false;
    }
  }

  return true;
}
