import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mock functions
const { mockSessions, mockDatabase, mockFleetMonitor, mockWorkflow, mockMemory } = vi.hoisted(() => {
  const mockSessions = new Map();
  const mockDatabase = {
    recordToolEvent: vi.fn(),
    updateToolEvent: vi.fn(),
  };
  const mockFleetMonitor = {
    incrementToolCount: vi.fn(),
    incrementAgentCount: vi.fn(),
    decrementAgentCount: vi.fn(),
    addFileTouched: vi.fn(),
  };
  const mockWorkflow = {
    evaluatePreToolUse: vi.fn(() => ({ action: 'allow' })),
    getWorkflowState: vi.fn(() => ({ phase: 'idle' })),
    getPhaseContext: vi.fn(() => null),
    inferPhaseFromAgent: vi.fn(() => null),
    transitionPhase: vi.fn(),
  };
  const mockMemory = {
    searchMemories: vi.fn(() => Promise.resolve('')),
  };
  return { mockSessions, mockDatabase, mockFleetMonitor, mockWorkflow, mockMemory };
});

// Mock dependencies
vi.mock("../session-manager.js", () => ({
  sessions: mockSessions,
}));

vi.mock("../database.js", () => mockDatabase);

vi.mock("../logger.js", () => ({
  log: {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../config.js", () => ({
  WORKFLOW_ENABLED: false,
  MEMORY_ENABLED: false,
  MEMORY_HOOK_TIMEOUT_MS: 1000,
}));

vi.mock("../workflow-state.js", () => mockWorkflow);

vi.mock("../fleet-monitor.js", () => mockFleetMonitor);

vi.mock("../memory-client.js", () => mockMemory);

import { buildHooks } from "../sdk/hooks.js";

describe("Code Review Gate", () => {
  const sessionId = "test-session";
  let hooks: ReturnType<typeof buildHooks>;
  let mockCallbacks: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallbacks = {
      onToolEvent: vi.fn(),
    };
    mockSessions.clear();
    mockSessions.set(sessionId, {
      callbacks: mockCallbacks,
      hadToolSinceLastText: false,
    });
    hooks = buildHooks(sessionId);
  });

  it("blocks git commit when writes occurred without code-reviewer", async () => {
    // 1. Simulate Write tool
    const writeHook = hooks.PreToolUse[0].hooks[0];
    await writeHook(
      {
        tool_name: "Write",
        tool_use_id: "tu_write_1",
        tool_input: { file_path: "/test/file.ts", content: "code" },
      },
      "tu_write_1"
    );

    // 2. Attempt git commit without code-reviewer
    const bashHook = hooks.PreToolUse[0].hooks[0];
    const result = await bashHook(
      {
        tool_name: "Bash",
        tool_use_id: "tu_bash_1",
        tool_input: { command: 'git commit -m "test"' },
      },
      "tu_bash_1"
    );

    // Should be blocked
    expect(result).toHaveProperty("hookSpecificOutput");
    expect(result.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("Code review required"),
    });
  });

  it("allows git commit when code-reviewer was invoked", async () => {
    // 1. Simulate Write tool
    const writeHook = hooks.PreToolUse[0].hooks[0];
    await writeHook(
      {
        tool_name: "Write",
        tool_use_id: "tu_write_1",
        tool_input: { file_path: "/test/file.ts", content: "code" },
      },
      "tu_write_1"
    );

    // 2. Simulate code-reviewer subagent
    const subagentStartHook = hooks.SubagentStart[0].hooks[0];
    await subagentStartHook({
      agent_id: "agent_1",
      agent_type: "code-reviewer",
      tool_input: { description: "Review code" },
    });

    // 3. Attempt git commit
    const bashHook = hooks.PreToolUse[0].hooks[0];
    const result = await bashHook(
      {
        tool_name: "Bash",
        tool_use_id: "tu_bash_1",
        tool_input: { command: 'git commit -m "test"' },
      },
      "tu_bash_1"
    );

    // Should be allowed (not blocked)
    expect(result).not.toHaveProperty("hookSpecificOutput");
  });

  it("allows git commit in read-only session (no Write/Edit)", async () => {
    // No Write or Edit tools called

    // Attempt git commit directly
    const bashHook = hooks.PreToolUse[0].hooks[0];
    const result = await bashHook(
      {
        tool_name: "Bash",
        tool_use_id: "tu_bash_1",
        tool_input: { command: 'git commit -m "test"' },
      },
      "tu_bash_1"
    );

    // Should be allowed (no writes, not blocked)
    expect(result).not.toHaveProperty("hookSpecificOutput");
  });

  it("allows non-commit bash commands with writes but no review", async () => {
    // 1. Simulate Edit tool
    const editHook = hooks.PreToolUse[0].hooks[0];
    await editHook(
      {
        tool_name: "Edit",
        tool_use_id: "tu_edit_1",
        tool_input: {
          file_path: "/test/file.ts",
          old_string: "old",
          new_string: "new",
        },
      },
      "tu_edit_1"
    );

    // 2. Run non-commit bash command
    const bashHook = hooks.PreToolUse[0].hooks[0];
    const result = await bashHook(
      {
        tool_name: "Bash",
        tool_use_id: "tu_bash_1",
        tool_input: { command: "npm test" },
      },
      "tu_bash_1"
    );

    // Should be allowed (not a commit, not blocked)
    expect(result).not.toHaveProperty("hookSpecificOutput");
  });

  it("allows git commit when only .md files were written (no code-reviewer needed)", async () => {
    const writeHook = hooks.PreToolUse[0].hooks[0];
    await writeHook(
      {
        tool_name: "Write",
        tool_use_id: "tu_write_1",
        tool_input: { file_path: "/docs/plans/my-plan.md", content: "# Plan" },
      },
      "tu_write_1"
    );
    await writeHook(
      {
        tool_name: "Edit",
        tool_use_id: "tu_edit_1",
        tool_input: { file_path: "/docs/README.MD", old_string: "old", new_string: "new" },
      },
      "tu_edit_1"
    );

    const bashHook = hooks.PreToolUse[0].hooks[0];
    const result = await bashHook(
      {
        tool_name: "Bash",
        tool_use_id: "tu_bash_1",
        tool_input: { command: 'git commit -m "docs: update plan"' },
      },
      "tu_bash_1"
    );

    expect(result).not.toHaveProperty("hookSpecificOutput");
  });

  it("blocks git commit when .ts and .md files were written without code-reviewer", async () => {
    const writeHook = hooks.PreToolUse[0].hooks[0];
    await writeHook(
      {
        tool_name: "Write",
        tool_use_id: "tu_write_1",
        tool_input: { file_path: "/src/feature.ts", content: "code" },
      },
      "tu_write_1"
    );
    await writeHook(
      {
        tool_name: "Write",
        tool_use_id: "tu_write_2",
        tool_input: { file_path: "/docs/notes.md", content: "# Notes" },
      },
      "tu_write_2"
    );

    const bashHook = hooks.PreToolUse[0].hooks[0];
    const result = await bashHook(
      {
        tool_name: "Bash",
        tool_use_id: "tu_bash_1",
        tool_input: { command: 'git commit -m "feat: add feature"' },
      },
      "tu_bash_1"
    );

    expect(result).toHaveProperty("hookSpecificOutput");
    expect(result.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("Code review required"),
    });
  });

  it("blocks git commit --amend with writes but no review", async () => {
    // 1. Simulate Write tool
    const writeHook = hooks.PreToolUse[0].hooks[0];
    await writeHook(
      {
        tool_name: "Write",
        tool_use_id: "tu_write_1",
        tool_input: { file_path: "/test/file.ts", content: "code" },
      },
      "tu_write_1"
    );

    // 2. Attempt git commit --amend
    const bashHook = hooks.PreToolUse[0].hooks[0];
    const result = await bashHook(
      {
        tool_name: "Bash",
        tool_use_id: "tu_bash_1",
        tool_input: { command: 'git commit --amend -m "updated"' },
      },
      "tu_bash_1"
    );

    // Should be blocked (contains "git commit")
    expect(result).toHaveProperty("hookSpecificOutput");
    expect(result.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("Code review required"),
    });
  });
});
