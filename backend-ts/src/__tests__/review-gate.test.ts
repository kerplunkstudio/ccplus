import { describe, expect, it } from "vitest";
import { evaluatePreToolUse } from "../workflow-state.js";
import type { WorkflowConfig } from "../workflow-config.js";

describe("Workflow-Based Commit Enforcement", () => {
  // Mock workflow with execute, review, and complete phases
  const mockWorkflow: WorkflowConfig = {
    name: "test-workflow",
    description: "Test workflow for commit enforcement",
    default_phase: "execute",
    phases: [
      {
        name: "execute",
        context: "Implementation phase",
        agent_hints: ["code_agent"],
        tool_rules: [
          {
            tool_name: "Bash",
            action: "block",
            conditions: ["command_contains:git commit"],
            message: "Execute phase: complete code review before committing.",
          },
        ],
      },
      {
        name: "review",
        context: "Code review phase",
        agent_hints: ["code-reviewer"],
        tool_rules: [
          {
            tool_name: "Bash",
            action: "block",
            conditions: ["command_contains:git commit"],
            message: "Review phase: commits are blocked until review completes.",
          },
        ],
      },
      {
        name: "complete",
        context: "Completion phase",
        agent_hints: [],
        tool_rules: [], // No rules - commits allowed
      },
    ],
    transitions: [
      { from: "execute", to: "review" },
      { from: "review", to: "complete" },
    ],
  };

  describe("Execute Phase", () => {
    it("blocks git commit commands", () => {
      const result = evaluatePreToolUse(
        "execute",
        "Bash",
        { command: 'git commit -m "test"' },
        mockWorkflow
      );

      expect(result).toEqual({
        action: "block",
        message: "Execute phase: complete code review before committing.",
      });
    });

    it("blocks git commit with --amend flag", () => {
      const result = evaluatePreToolUse(
        "execute",
        "Bash",
        { command: 'git commit --amend -m "updated"' },
        mockWorkflow
      );

      expect(result).toEqual({
        action: "block",
        message: "Execute phase: complete code review before committing.",
      });
    });

    it("blocks git commit with --no-verify flag", () => {
      const result = evaluatePreToolUse(
        "execute",
        "Bash",
        { command: 'git commit --no-verify -m "bypass hooks"' },
        mockWorkflow
      );

      expect(result).toEqual({
        action: "block",
        message: "Execute phase: complete code review before committing.",
      });
    });

    it("allows non-commit bash commands", () => {
      const testCommands = [
        "npm test",
        "git status",
        "git diff",
        "git add file.ts",
        "ls -la",
        "echo 'not a commit'",
      ];

      testCommands.forEach((command) => {
        const result = evaluatePreToolUse(
          "execute",
          "Bash",
          { command },
          mockWorkflow
        );

        expect(result).toEqual({ action: "allow" });
      });
    });

    it("allows non-Bash tools", () => {
      const result = evaluatePreToolUse(
        "execute",
        "Write",
        { file_path: "/test/file.ts", content: "code" },
        mockWorkflow
      );

      expect(result).toEqual({ action: "allow" });
    });
  });

  describe("Review Phase", () => {
    it("blocks git commit commands", () => {
      const result = evaluatePreToolUse(
        "review",
        "Bash",
        { command: 'git commit -m "test"' },
        mockWorkflow
      );

      expect(result).toEqual({
        action: "block",
        message: "Review phase: commits are blocked until review completes.",
      });
    });

    it("blocks git commit --amend", () => {
      const result = evaluatePreToolUse(
        "review",
        "Bash",
        { command: 'git commit --amend --no-edit' },
        mockWorkflow
      );

      expect(result).toEqual({
        action: "block",
        message: "Review phase: commits are blocked until review completes.",
      });
    });

    it("allows non-commit bash commands", () => {
      const result = evaluatePreToolUse(
        "review",
        "Bash",
        { command: "git diff HEAD" },
        mockWorkflow
      );

      expect(result).toEqual({ action: "allow" });
    });
  });

  describe("Complete Phase", () => {
    it("allows git commit commands (no rules)", () => {
      const result = evaluatePreToolUse(
        "complete",
        "Bash",
        { command: 'git commit -m "final commit"' },
        mockWorkflow
      );

      expect(result).toEqual({ action: "allow" });
    });

    it("allows git commit --amend", () => {
      const result = evaluatePreToolUse(
        "complete",
        "Bash",
        { command: 'git commit --amend -m "updated"' },
        mockWorkflow
      );

      expect(result).toEqual({ action: "allow" });
    });

    it("allows all bash commands", () => {
      const testCommands = [
        'git commit -m "feat: add feature"',
        "npm test",
        "git push",
      ];

      testCommands.forEach((command) => {
        const result = evaluatePreToolUse(
          "complete",
          "Bash",
          { command },
          mockWorkflow
        );

        expect(result).toEqual({ action: "allow" });
      });
    });
  });

  describe("Command Matching", () => {
    it("matches various git commit command formats", () => {
      const commitCommands = [
        'git commit -m "message"',
        "git commit --amend",
        'git commit --amend -m "msg"',
        "git commit --no-verify",
        'git commit -am "all changes"',
        "git commit --allow-empty",
        'git commit -m "msg" --no-gpg-sign',
      ];

      commitCommands.forEach((command) => {
        const result = evaluatePreToolUse(
          "execute",
          "Bash",
          { command },
          mockWorkflow
        );

        expect(result.action).toBe("block");
        expect(result.message).toContain("complete code review");
      });
    });

    it("does not match non-commit git commands", () => {
      const nonCommitCommands = [
        "git status",
        "git diff",
        "git log",
        "git add file.ts",
        "git checkout branch",
        "git push",
        "git pull",
        "git branch",
      ];

      nonCommitCommands.forEach((command) => {
        const result = evaluatePreToolUse(
          "execute",
          "Bash",
          { command },
          mockWorkflow
        );

        expect(result).toEqual({ action: "allow" });
      });
    });
  });

  describe("No Workflow", () => {
    it("allows all commands when workflow is null", () => {
      const result = evaluatePreToolUse(
        "execute",
        "Bash",
        { command: 'git commit -m "test"' },
        null
      );

      expect(result).toEqual({ action: "allow" });
    });

    it("allows all tools when workflow is null", () => {
      const result = evaluatePreToolUse(
        "execute",
        "Write",
        { file_path: "/test/file.ts", content: "code" },
        null
      );

      expect(result).toEqual({ action: "allow" });
    });
  });
});
