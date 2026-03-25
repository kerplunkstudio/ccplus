import { beforeEach, describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as config from "../config.js";
import { getAllWorkflows, getWorkflowByName, upsertWorkflow, deleteWorkflow, workflowExists } from "../db/workflows.js";
import { seedWorkflows } from "../workflow-config.js";
import type { WorkflowConfig } from "../workflow-config.js";

describe("Workflow Database Operations", () => {
  beforeEach(() => {
    // Clean up workflows table
    const database = new Database(config.DATABASE_PATH);
    try {
      database.exec("DELETE FROM workflows");
    } catch {
      // Table might not exist yet
    }
    database.close();
  });

  describe("getAllWorkflows", () => {
    it("returns empty array when no workflows exist", () => {
      const workflows = getAllWorkflows();
      expect(workflows).toEqual([]);
    });

    it("returns all workflows sorted by name", () => {
      const workflow1: WorkflowConfig = {
        name: "beta",
        description: "Beta workflow",
        default_phase: "start",
        phases: [],
        transitions: [],
      };

      const workflow2: WorkflowConfig = {
        name: "alpha",
        description: "Alpha workflow",
        default_phase: "start",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(workflow1);
      upsertWorkflow(workflow2);

      const workflows = getAllWorkflows();
      expect(workflows).toHaveLength(2);
      expect(workflows[0].name).toBe("alpha");
      expect(workflows[1].name).toBe("beta");
    });
  });

  describe("getWorkflowByName", () => {
    it("returns null when workflow does not exist", () => {
      const workflow = getWorkflowByName("nonexistent");
      expect(workflow).toBeNull();
    });

    it("returns workflow when it exists", () => {
      const testWorkflow: WorkflowConfig = {
        name: "test",
        description: "Test workflow",
        default_phase: "start",
        phases: [
          {
            name: "start",
            context: "Starting phase",
            agent_hints: ["hint1", "hint2"],
            tool_rules: [
              {
                tool_name: "bash",
                action: "allow",
                conditions: ["always"],
                message: "Allow bash",
              },
            ],
          },
        ],
        transitions: [{ from: "start", to: "end" }],
        worktree: true,
      };

      upsertWorkflow(testWorkflow);

      const retrieved = getWorkflowByName("test");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("test");
      expect(retrieved!.description).toBe("Test workflow");
      expect(retrieved!.default_phase).toBe("start");
      expect(retrieved!.phases).toHaveLength(1);
      expect(retrieved!.phases[0].name).toBe("start");
      expect(retrieved!.phases[0].agent_hints).toEqual(["hint1", "hint2"]);
      expect(retrieved!.phases[0].tool_rules).toHaveLength(1);
      expect(retrieved!.phases[0].tool_rules[0].tool_name).toBe("bash");
      expect(retrieved!.transitions).toEqual([{ from: "start", to: "end" }]);
      expect(retrieved!.worktree).toBe(true);
    });
  });

  describe("upsertWorkflow", () => {
    it("inserts new workflow", () => {
      const workflow: WorkflowConfig = {
        name: "new",
        description: "New workflow",
        default_phase: "init",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(workflow);

      const retrieved = getWorkflowByName("new");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("new");
      expect(retrieved!.description).toBe("New workflow");
    });

    it("updates existing workflow", () => {
      const workflow: WorkflowConfig = {
        name: "update-test",
        description: "Original description",
        default_phase: "start",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(workflow);

      const updated: WorkflowConfig = {
        name: "update-test",
        description: "Updated description",
        default_phase: "new-start",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(updated);

      const retrieved = getWorkflowByName("update-test");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.description).toBe("Updated description");
      expect(retrieved!.default_phase).toBe("new-start");

      const all = getAllWorkflows();
      expect(all).toHaveLength(1);
    });

    it("sets builtin flag correctly", () => {
      const workflow: WorkflowConfig = {
        name: "builtin-test",
        description: "Builtin workflow",
        default_phase: "start",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(workflow, true);

      const retrieved = getWorkflowByName("builtin-test");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.builtin).toBe(true);
    });

    it("handles worktree boolean correctly", () => {
      const workflowTrue: WorkflowConfig = {
        name: "worktree-true",
        description: "With worktree",
        default_phase: "start",
        phases: [],
        transitions: [],
        worktree: true,
      };

      const workflowFalse: WorkflowConfig = {
        name: "worktree-false",
        description: "Without worktree",
        default_phase: "start",
        phases: [],
        transitions: [],
        worktree: false,
      };

      const workflowUndefined: WorkflowConfig = {
        name: "worktree-undefined",
        description: "Undefined worktree",
        default_phase: "start",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(workflowTrue);
      upsertWorkflow(workflowFalse);
      upsertWorkflow(workflowUndefined);

      const retrievedTrue = getWorkflowByName("worktree-true");
      expect(retrievedTrue!.worktree).toBe(true);

      const retrievedFalse = getWorkflowByName("worktree-false");
      expect(retrievedFalse!.worktree).toBe(false);

      const retrievedUndefined = getWorkflowByName("worktree-undefined");
      expect(retrievedUndefined!.worktree).toBeUndefined();
    });
  });

  describe("deleteWorkflow", () => {
    it("deletes existing workflow and returns true", () => {
      const workflow: WorkflowConfig = {
        name: "to-delete",
        description: "Will be deleted",
        default_phase: "start",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(workflow);
      expect(workflowExists("to-delete")).toBe(true);

      const deleted = deleteWorkflow("to-delete");
      expect(deleted).toBe(true);
      expect(workflowExists("to-delete")).toBe(false);
    });

    it("returns false when workflow does not exist", () => {
      const deleted = deleteWorkflow("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("workflowExists", () => {
    it("returns false for nonexistent workflow", () => {
      expect(workflowExists("nonexistent")).toBe(false);
    });

    it("returns true for existing workflow", () => {
      const workflow: WorkflowConfig = {
        name: "exists",
        description: "Exists",
        default_phase: "start",
        phases: [],
        transitions: [],
      };

      upsertWorkflow(workflow);
      expect(workflowExists("exists")).toBe(true);
    });
  });

  describe("seedWorkflows", () => {
    it("is idempotent - does not overwrite existing workflows", () => {
      // First seed
      seedWorkflows();
      const firstCount = getAllWorkflows().length;

      // Modify a workflow if it exists
      const workflows = getAllWorkflows();
      if (workflows.length > 0) {
        const modified: WorkflowConfig = {
          ...workflows[0],
          description: "Modified description",
        };
        upsertWorkflow(modified, false);

        // Second seed should not overwrite
        seedWorkflows();
        const retrieved = getWorkflowByName(workflows[0].name);
        expect(retrieved!.description).toBe("Modified description");
      }

      const secondCount = getAllWorkflows().length;
      expect(secondCount).toBe(firstCount);
    });

    it("seeds workflows from YAML files", () => {
      // Clean database
      const database = new Database(config.DATABASE_PATH);
      database.exec("DELETE FROM workflows");
      database.close();

      // Seed workflows
      seedWorkflows();

      // Check that workflows were seeded
      const workflows = getAllWorkflows();
      // At minimum, the default workflow should exist
      const defaultWorkflow = getWorkflowByName("default");
      expect(defaultWorkflow).not.toBeNull();
    });
  });
});
