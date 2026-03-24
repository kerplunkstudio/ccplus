import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { PROJECT_ROOT } from './config.js';
import { log } from './logger.js';

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

// ---- Public API ----

export function loadWorkflow(workflowName: string, _workspace?: string): WorkflowConfig {
  const yamlPath = findWorkflowYaml(workflowName);

  if (!yamlPath) {
    // If workflow not found by name, try to load 'default' as fallback
    if (workflowName !== 'default') {
      log.warn('Workflow not found, falling back to default', { workflowName });
      const defaultPath = findWorkflowYaml('default');
      if (!defaultPath) {
        throw new Error('Default workflow not found. Expected workflow.yaml in .ccplus/workflows/default/ or ~/.ccplus/workflows/default/');
      }
      return loadWorkflowFromPath(defaultPath);
    }
    throw new Error(`Workflow not found: ${workflowName}. Expected workflow.yaml in .ccplus/workflows/${workflowName}/ or ~/.ccplus/workflows/${workflowName}/`);
  }

  return loadWorkflowFromPath(yamlPath);
}

function loadWorkflowFromPath(yamlPath: string): WorkflowConfig {
  try {
    const yamlContent = readFileSync(yamlPath, 'utf-8');
    const workflow = parseYamlWorkflow(yamlContent);
    log.info('Loaded workflow', { name: workflow.name, path: yamlPath });
    return workflow;
  } catch (error) {
    log.error('Failed to load workflow', { path: yamlPath, error: String(error) });
    throw new Error(`Failed to load workflow from ${yamlPath}: ${error}`);
  }
}

export function getWorkflowByName(workflowName: string, _workspace?: string): WorkflowConfig | null {
  try {
    return loadWorkflow(workflowName, _workspace);
  } catch {
    return null;
  }
}

export function listWorkflows(_workspace?: string): string[] {
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
