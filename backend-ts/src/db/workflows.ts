import { getDb } from "./connection.js";
import type { WorkflowConfig } from "../workflow-config.js";

export function getAllWorkflows(): WorkflowConfig[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM workflows ORDER BY name").all() as Array<{
    name: string;
    description: string;
    default_phase: string;
    phases: string;
    transitions: string;
    worktree: number | null;
    builtin: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    name: row.name,
    description: row.description,
    default_phase: row.default_phase,
    phases: JSON.parse(row.phases),
    transitions: JSON.parse(row.transitions),
    worktree: row.worktree === 1 ? true : row.worktree === 0 ? false : undefined,
    builtin: row.builtin === 1,
  }));
}

export function getWorkflowByName(name: string): WorkflowConfig | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM workflows WHERE name = ?").get(name) as {
    name: string;
    description: string;
    default_phase: string;
    phases: string;
    transitions: string;
    worktree: number | null;
    builtin: number;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    name: row.name,
    description: row.description,
    default_phase: row.default_phase,
    phases: JSON.parse(row.phases),
    transitions: JSON.parse(row.transitions),
    worktree: row.worktree === 1 ? true : row.worktree === 0 ? false : undefined,
    builtin: row.builtin === 1,
  };
}

export function upsertWorkflow(workflow: WorkflowConfig, builtin: boolean = false): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO workflows (name, description, default_phase, phases, transitions, worktree, builtin, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      default_phase = excluded.default_phase,
      phases = excluded.phases,
      transitions = excluded.transitions,
      worktree = excluded.worktree,
      builtin = excluded.builtin,
      updated_at = datetime('now', 'localtime')
  `);

  stmt.run(
    workflow.name,
    workflow.description,
    workflow.default_phase,
    JSON.stringify(workflow.phases),
    JSON.stringify(workflow.transitions),
    workflow.worktree === true ? 1 : workflow.worktree === false ? 0 : null,
    builtin ? 1 : 0,
  );
}

export function deleteWorkflow(name: string): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM workflows WHERE name = ?").run(name);
  return result.changes > 0;
}

export function workflowExists(name: string): boolean {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as count FROM workflows WHERE name = ?").get(name) as { count: number };
  return row.count > 0;
}
