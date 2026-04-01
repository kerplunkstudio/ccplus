import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runKairosAnalysis } from "../kairos-runner.js";
import type { KairosRunnerDeps } from "../kairos-runner.js";
import * as fleetSessionsDb from "../db/fleet-sessions.js";
import * as kairosDb from "../db/kairos.js";
import * as kairosPrompt from "../kairos-prompt.js";
import * as config from "../config.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";

vi.mock("@anthropic-ai/claude-agent-sdk");
vi.mock("../db/fleet-sessions.js");
vi.mock("../db/kairos.js");
vi.mock("../kairos-prompt.js");
vi.mock("../config.js", async () => {
  const actual = await vi.importActual("../config.js");
  return {
    ...actual,
    KAIROS_MODEL: "claude-opus-4-6",
    KAIROS_MAX_ANALYSIS_TURNS: 5,
    CAPTAIN_WORKSPACE: "/test/workspace",
    BYPASS_PERMISSIONS: true,
    PROJECT_ROOT: "/test/project",
  };
});
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});
vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("kairos-runner", () => {
  const mockDeps: KairosRunnerDeps = {
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock homedir and fs functions
    vi.mocked(homedir).mockReturnValue("/home/test");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(["code_agent.md", "frontend-agent.md"] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runKairosAnalysis", () => {
    it("returns zero results when no sessions are found", async () => {
      vi.mocked(fleetSessionsDb.getFleetSession).mockReturnValue(null);

      const result = await runKairosAnalysis(["non-existent-session"], mockDeps);

      expect(result.analyzed).toBe(0);
      expect(result.correlationsFound).toBe(0);
      expect(result.promptChangesRecommended).toBe(0);
      expect(mockDeps.log.warn).toHaveBeenCalledWith("Session not found in fleet_sessions, skipping", {
        sessionId: "non-existent-session",
      });
    });

    it("processes a successful analysis with correlations", async () => {
      // Mock fleet session data
      vi.mocked(fleetSessionsDb.getFleetSession).mockImplementation((sessionId) => ({
        sessionId,
        status: "completed",
        workspace: "/workspace",
        toolCount: 10,
        activeAgents: 0,
        totalAgents: 1,
        inputTokens: 5000,
        outputTokens: 3000,
        durationMs: 45000,
        startedAt: "2024-03-20T10:00:00Z",
        lastActivity: "2024-03-20T10:01:00Z",
        label: "feature",
        filesTouched: ["src/auth.ts"],
        description: "Implement login",
      }));

      // Mock existing correlations
      vi.mocked(kairosDb.getCorrelationsForSession).mockReturnValue([]);

      // Mock prompts
      vi.mocked(kairosPrompt.buildKairosSystemPrompt).mockReturnValue("System prompt");
      vi.mocked(kairosPrompt.buildKairosUserPrompt).mockReturnValue("User prompt");

      // Mock SDK query response
      const mockJsonOutput = JSON.stringify({
        batch_summary: {
          total_sessions: 1,
          successes: 1,
          partial: 0,
          failures: 0,
          correlations_found: 1,
          prompt_changes_recommended: 0,
        },
        analyses: [
          {
            session_id: "feat-auth",
            task_intent: "Implement login authentication",
            task_type: "feature",
            actual_outcome: "success",
            outcome_reasoning: "Login implemented successfully",
            follow_up_needed: false,
            correlations: [
              {
                related_session_id: "fix-auth",
                relation_type: "followed_by",
                confidence: 0.8,
                evidence: "Fixed a bug in the login flow",
              },
            ],
          },
        ],
      });

      const mockMessages = [
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: mockJsonOutput,
              },
            ],
          },
        },
        {
          type: "result",
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
        },
      ];

      vi.mocked(query).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        },
      } as any);

      const result = await runKairosAnalysis(["feat-auth"], mockDeps);

      expect(result.analyzed).toBe(1);
      expect(result.correlationsFound).toBe(1);
      expect(result.promptChangesRecommended).toBe(0);
      expect(result.totalTokens).toBe(1500);

      expect(kairosDb.ensureAnalysisRecord).toHaveBeenCalledWith("feat-auth");
      expect(kairosDb.markAnalysisStarted).toHaveBeenCalledWith("feat-auth", "claude-opus-4-6");
      expect(kairosDb.markAnalysisCompleted).toHaveBeenCalled();
      expect(kairosDb.addCorrelation).toHaveBeenCalledWith({
        sourceSessionId: "feat-auth",
        targetSessionId: "fix-auth",
        relationType: "followed_by",
        confidence: 0.8,
        evidence: "Fixed a bug in the login flow",
      });
    });

    it("handles SDK query failure gracefully", async () => {
      vi.mocked(fleetSessionsDb.getFleetSession).mockReturnValue({
        sessionId: "test-session",
        status: "completed",
        workspace: "/workspace",
        toolCount: 10,
        activeAgents: 0,
        totalAgents: 1,
        inputTokens: 5000,
        outputTokens: 3000,
        durationMs: 45000,
        startedAt: "2024-03-20T10:00:00Z",
        lastActivity: "2024-03-20T10:01:00Z",
        label: "feature",
        filesTouched: [],
        description: null,
      });

      vi.mocked(kairosDb.getCorrelationsForSession).mockReturnValue([]);
      vi.mocked(kairosPrompt.buildKairosSystemPrompt).mockReturnValue("System prompt");
      vi.mocked(kairosPrompt.buildKairosUserPrompt).mockReturnValue("User prompt");

      // Mock query to throw an error
      vi.mocked(query).mockImplementation(() => {
        throw new Error("API error");
      });

      const result = await runKairosAnalysis(["test-session"], mockDeps);

      expect(result.analyzed).toBe(0);
      expect(result.correlationsFound).toBe(0);
      expect(kairosDb.markAnalysisFailed).toHaveBeenCalledWith("test-session", "Error: API error");
      expect(mockDeps.log.error).toHaveBeenCalledWith("KAIROS query failed", expect.any(Object));
    });

    it("handles invalid JSON output", async () => {
      vi.mocked(fleetSessionsDb.getFleetSession).mockReturnValue({
        sessionId: "test-session",
        status: "completed",
        workspace: "/workspace",
        toolCount: 10,
        activeAgents: 0,
        totalAgents: 1,
        inputTokens: 5000,
        outputTokens: 3000,
        durationMs: 45000,
        startedAt: "2024-03-20T10:00:00Z",
        lastActivity: "2024-03-20T10:01:00Z",
        label: "feature",
        filesTouched: [],
        description: null,
      });

      vi.mocked(kairosDb.getCorrelationsForSession).mockReturnValue([]);
      vi.mocked(kairosPrompt.buildKairosSystemPrompt).mockReturnValue("System prompt");
      vi.mocked(kairosPrompt.buildKairosUserPrompt).mockReturnValue("User prompt");

      // Mock invalid JSON response
      const mockMessages = [
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "This is not valid JSON",
              },
            ],
          },
        },
        {
          type: "result",
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
          },
        },
      ];

      vi.mocked(query).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        },
      } as any);

      const result = await runKairosAnalysis(["test-session"], mockDeps);

      expect(result.analyzed).toBe(0);
      expect(kairosDb.markAnalysisFailed).toHaveBeenCalledWith("test-session", "Invalid JSON output");
      expect(mockDeps.log.error).toHaveBeenCalledWith("Failed to parse KAIROS JSON output");
    });

    it("extracts JSON from markdown code blocks", async () => {
      vi.mocked(fleetSessionsDb.getFleetSession).mockReturnValue({
        sessionId: "test-session",
        status: "completed",
        workspace: "/workspace",
        toolCount: 5,
        activeAgents: 0,
        totalAgents: 1,
        inputTokens: 1000,
        outputTokens: 500,
        durationMs: 10000,
        startedAt: "2024-03-20T10:00:00Z",
        lastActivity: "2024-03-20T10:01:00Z",
        label: "test",
        filesTouched: [],
        description: null,
      });

      vi.mocked(kairosDb.getCorrelationsForSession).mockReturnValue([]);
      vi.mocked(kairosPrompt.buildKairosSystemPrompt).mockReturnValue("System prompt");
      vi.mocked(kairosPrompt.buildKairosUserPrompt).mockReturnValue("User prompt");

      const mockJsonInCodeBlock = `\`\`\`json
{
  "batch_summary": {
    "total_sessions": 1,
    "successes": 1,
    "partial": 0,
    "failures": 0,
    "correlations_found": 0,
    "prompt_changes_recommended": 0
  },
  "analyses": [
    {
      "session_id": "test-session",
      "task_intent": "Test task",
      "task_type": "test",
      "actual_outcome": "success",
      "outcome_reasoning": "Test completed",
      "follow_up_needed": false
    }
  ]
}
\`\`\``;

      const mockMessages = [
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: mockJsonInCodeBlock,
              },
            ],
          },
        },
        {
          type: "result",
          usage: {
            input_tokens: 500,
            output_tokens: 200,
          },
        },
      ];

      vi.mocked(query).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        },
      } as any);

      const result = await runKairosAnalysis(["test-session"], mockDeps);

      expect(result.analyzed).toBe(1);
      expect(kairosDb.markAnalysisCompleted).toHaveBeenCalled();
    });

    it("processes prompt change recommendations", async () => {
      vi.mocked(fleetSessionsDb.getFleetSession).mockReturnValue({
        sessionId: "feat-auth",
        status: "completed",
        workspace: "/workspace",
        toolCount: 10,
        activeAgents: 0,
        totalAgents: 1,
        inputTokens: 5000,
        outputTokens: 3000,
        durationMs: 45000,
        startedAt: "2024-03-20T10:00:00Z",
        lastActivity: "2024-03-20T10:01:00Z",
        label: "feature",
        filesTouched: ["src/auth.ts"],
        description: "Implement login",
      });

      vi.mocked(kairosDb.getCorrelationsForSession).mockReturnValue([]);
      vi.mocked(kairosPrompt.buildKairosSystemPrompt).mockReturnValue("System prompt");
      vi.mocked(kairosPrompt.buildKairosUserPrompt).mockReturnValue("User prompt");

      const mockJsonOutput = JSON.stringify({
        batch_summary: {
          total_sessions: 1,
          successes: 0,
          partial: 1,
          failures: 0,
          correlations_found: 0,
          prompt_changes_recommended: 1,
        },
        analyses: [
          {
            session_id: "feat-auth",
            task_intent: "Implement login",
            task_type: "feature",
            actual_outcome: "partial",
            outcome_reasoning: "Login works but introduced regression",
            follow_up_needed: true,
          },
        ],
        prompt_changes: [
          {
            target_file: "/home/user/.claude/agents/code_agent.md",
            section: "## Testing Requirements",
            change_type: "addition",
            current_text: "",
            proposed_text: "Always run integration tests after modifying shared modules.",
            reasoning: "Session feat-auth introduced a regression",
            evidence_session_ids: ["feat-auth"],
            confidence: 0.85,
          },
        ],
      });

      const mockMessages = [
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: mockJsonOutput,
              },
            ],
          },
        },
        {
          type: "result",
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
        },
      ];

      vi.mocked(query).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        },
      } as any);

      const result = await runKairosAnalysis(["feat-auth"], mockDeps);

      expect(result.analyzed).toBe(1);
      expect(result.promptChangesRecommended).toBe(1);
      expect(result.promptChanges).toHaveLength(1);
      expect(result.promptChanges[0].targetFile).toBe("/home/user/.claude/agents/code_agent.md");
      expect(result.promptChanges[0].confidence).toBe(0.85);
    });
  });
});
