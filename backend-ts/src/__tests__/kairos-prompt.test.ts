import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildKairosSystemPrompt, buildKairosUserPrompt } from "../kairos-prompt.js";
import type { KairosBatchInput, KairosSessionInput } from "../kairos-prompt.js";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";

vi.mock("fs");
vi.mock("os");
vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("kairos-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildKairosSystemPrompt", () => {
    it("returns prompt from kairos.md if file exists", () => {
      const mockHomedir = "/home/test";
      const expectedPath = path.join(mockHomedir, ".claude", "agents", "kairos.md");
      const mockContent = `---
name: kairos
---

You are KAIROS, the retrospective learning agent.`;

      vi.mocked(homedir).mockReturnValue(mockHomedir);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(mockContent);

      const result = buildKairosSystemPrompt();

      expect(existsSync).toHaveBeenCalledWith(expectedPath);
      expect(readFileSync).toHaveBeenCalledWith(expectedPath, "utf-8");
      expect(result).toBe("You are KAIROS, the retrospective learning agent.");
    });

    it("strips frontmatter from kairos.md content", () => {
      const mockHomedir = "/home/test";
      const mockContent = `---
name: kairos
description: Test
---

System prompt content here.

More content.`;

      vi.mocked(homedir).mockReturnValue(mockHomedir);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(mockContent);

      const result = buildKairosSystemPrompt();

      expect(result).toBe("System prompt content here.\n\nMore content.");
    });

    it("returns fallback prompt if kairos.md does not exist", () => {
      const mockHomedir = "/home/test";

      vi.mocked(homedir).mockReturnValue(mockHomedir);
      vi.mocked(existsSync).mockReturnValue(false);

      const result = buildKairosSystemPrompt();

      expect(result).toContain("You are KAIROS");
      expect(result).toContain("retrospective learning agent");
    });

    it("returns fallback prompt if reading kairos.md fails", () => {
      const mockHomedir = "/home/test";

      vi.mocked(homedir).mockReturnValue(mockHomedir);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("Read error");
      });

      const result = buildKairosSystemPrompt();

      expect(result).toContain("You are KAIROS");
    });
  });

  describe("buildKairosUserPrompt", () => {
    it("builds a valid user prompt with session summaries", () => {
      const sessions: KairosSessionInput[] = [
        {
          sessionId: "feat-auth-login",
          status: "completed",
          description: "Implement login flow",
          workspace: "/path/to/workspace",
          startedAt: "2024-03-20T10:00:00Z",
          durationMs: 45000,
          toolCount: 12,
          inputTokens: 5000,
          outputTokens: 3000,
          filesTouched: ["src/auth/login.ts", "src/auth/types.ts"],
          label: "feature",
        },
      ];

      const input: KairosBatchInput = {
        sessions,
        existingCorrelations: [],
        modifiablePromptFiles: [],
      };

      const result = buildKairosUserPrompt(input);

      expect(result).toContain("# Batch Analysis Request");
      expect(result).toContain("Analyze the following batch of 1 sessions");
      expect(result).toContain("### Session: feat-auth-login [feature]");
      expect(result).toContain("**Status**: completed");
      expect(result).toContain("**Description**: Implement login flow");
      expect(result).toContain("**Duration**: 45s");
      expect(result).toContain("**Tools Used**: 12");
      expect(result).toContain("**Tokens**: 5000 in, 3000 out");
      expect(result).toContain("**Files Touched**: src/auth/login.ts, src/auth/types.ts");
    });

    it("formats duration correctly for different ranges", () => {
      const sessions: KairosSessionInput[] = [
        {
          sessionId: "test-1",
          status: "completed",
          description: null,
          workspace: "/workspace",
          startedAt: "2024-03-20T10:00:00Z",
          durationMs: 500,
          toolCount: 1,
          inputTokens: 100,
          outputTokens: 50,
          filesTouched: [],
          label: null,
        },
        {
          sessionId: "test-2",
          status: "completed",
          description: null,
          workspace: "/workspace",
          startedAt: "2024-03-20T10:00:00Z",
          durationMs: 5000,
          toolCount: 1,
          inputTokens: 100,
          outputTokens: 50,
          filesTouched: [],
          label: null,
        },
        {
          sessionId: "test-3",
          status: "completed",
          description: null,
          workspace: "/workspace",
          startedAt: "2024-03-20T10:00:00Z",
          durationMs: 125000,
          toolCount: 1,
          inputTokens: 100,
          outputTokens: 50,
          filesTouched: [],
          label: null,
        },
      ];

      const input: KairosBatchInput = {
        sessions,
        existingCorrelations: [],
        modifiablePromptFiles: [],
      };

      const result = buildKairosUserPrompt(input);

      expect(result).toContain("**Duration**: 500ms");
      expect(result).toContain("**Duration**: 5s");
      expect(result).toContain("**Duration**: 2m 5s");
    });

    it("includes existing correlations section when present", () => {
      const sessions: KairosSessionInput[] = [
        {
          sessionId: "fix-auth",
          status: "completed",
          description: null,
          workspace: "/workspace",
          startedAt: "2024-03-20T10:00:00Z",
          durationMs: 10000,
          toolCount: 5,
          inputTokens: 1000,
          outputTokens: 500,
          filesTouched: [],
          label: null,
        },
      ];

      const input: KairosBatchInput = {
        sessions,
        existingCorrelations: [
          {
            sourceSessionId: "feat-auth",
            targetSessionId: "fix-auth",
            relationType: "bug_fix_for",
          },
        ],
        modifiablePromptFiles: [],
      };

      const result = buildKairosUserPrompt(input);

      expect(result).toContain("## Existing Correlations");
      expect(result).toContain("feat-auth → fix-auth (bug_fix_for)");
    });

    it("includes modifiable prompt files section when present", () => {
      const sessions: KairosSessionInput[] = [
        {
          sessionId: "test",
          status: "completed",
          description: null,
          workspace: "/workspace",
          startedAt: "2024-03-20T10:00:00Z",
          durationMs: 10000,
          toolCount: 5,
          inputTokens: 1000,
          outputTokens: 500,
          filesTouched: [],
          label: null,
        },
      ];

      const input: KairosBatchInput = {
        sessions,
        existingCorrelations: [],
        modifiablePromptFiles: [
          "/home/user/.claude/agents/code_agent.md",
          "/home/user/.claude/agents/frontend-agent.md",
        ],
      };

      const result = buildKairosUserPrompt(input);

      expect(result).toContain("## Modifiable Prompt Files");
      expect(result).toContain("/home/user/.claude/agents/code_agent.md");
      expect(result).toContain("/home/user/.claude/agents/frontend-agent.md");
    });

    it("handles sessions with no description, label, or files touched", () => {
      const sessions: KairosSessionInput[] = [
        {
          sessionId: "minimal-session",
          status: "failed",
          description: null,
          workspace: "/workspace",
          startedAt: "2024-03-20T10:00:00Z",
          durationMs: 1000,
          toolCount: 0,
          inputTokens: 100,
          outputTokens: 50,
          filesTouched: [],
          label: null,
        },
      ];

      const input: KairosBatchInput = {
        sessions,
        existingCorrelations: [],
        modifiablePromptFiles: [],
      };

      const result = buildKairosUserPrompt(input);

      expect(result).toContain("### Session: minimal-session");
      expect(result).not.toContain("[");
      expect(result).toContain("**Description**: No description");
      expect(result).toContain("**Files Touched**: none");
    });

    it("includes instructions section", () => {
      const input: KairosBatchInput = {
        sessions: [],
        existingCorrelations: [],
        modifiablePromptFiles: [],
      };

      const result = buildKairosUserPrompt(input);

      expect(result).toContain("## Instructions");
      expect(result).toContain("For each session:");
      expect(result).toContain("Determine the task intent");
      expect(result).toContain("Assess the actual outcome");
      expect(result).toContain("maximum 3 per batch, confidence >= 0.6");
    });
  });
});
