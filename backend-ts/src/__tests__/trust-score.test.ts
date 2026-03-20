import { describe, it, expect } from "vitest";
import {
  computeSummary,
  computeFlags,
  scoreTestCoverage,
  scoreScopeDiscipline,
  scoreErrorRate,
  scoreCostEfficiency,
  scoreSecurity,
  computeTrustScore,
  type SessionToolData,
  type SessionQueryData,
  type SessionConversationData,
} from "../trust-score.js";

describe("Trust Score Tests", () => {
  describe("computeSummary", () => {
    it("should return zeroed/empty summary with empty inputs", () => {
      const summary = computeSummary([], [], []);

      expect(summary.files_touched).toEqual([]);
      expect(summary.files_created).toEqual([]);
      expect(summary.files_deleted).toEqual([]);
      expect(summary.tests_run).toBe(0);
      expect(summary.tests_passed).toBe(0);
      expect(summary.tests_failed).toBe(0);
      expect(summary.total_tool_calls).toBe(0);
      expect(summary.failed_tool_calls).toBe(0);
      expect(summary.total_tokens).toBe(0);
      expect(summary.total_cost_usd).toBe(0);
      expect(summary.duration_ms).toBe(0);
      expect(summary.agents_spawned).toBe(0);
      expect(summary.security_flags).toEqual([]);
    });

    it("should detect test runs from Bash tool calls", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "npm test" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "cd backend-ts && vitest" }),
          success: 0,
          timestamp: "2026-03-20T10:01:00Z",
        },
      ];

      const summary = computeSummary(tools, [], []);

      expect(summary.tests_run).toBe(2);
      expect(summary.tests_passed).toBe(1);
      expect(summary.tests_failed).toBe(1);
    });

    it("should extract file paths from Write/Edit tools", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/path/to/new-file.ts", content: "code" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Edit",
          parameters: JSON.stringify({ file_path: "/path/to/existing.ts", old_string: "a", new_string: "b" }),
          success: 1,
          timestamp: "2026-03-20T10:01:00Z",
        },
        {
          tool_name: "Read",
          parameters: JSON.stringify({ file_path: "/path/to/read.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:02:00Z",
        },
      ];

      const summary = computeSummary(tools, [], []);

      expect(summary.files_created).toContain("/path/to/new-file.ts");
      expect(summary.files_touched).toContain("/path/to/new-file.ts");
      expect(summary.files_touched).toContain("/path/to/existing.ts");
      expect(summary.files_touched).toContain("/path/to/read.ts");
      expect(summary.files_touched.length).toBe(3);
    });

    it("should count agents from Agent tool calls", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Agent",
          parameters: JSON.stringify({ agent: "code_agent", task: "implement feature" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Agent",
          parameters: JSON.stringify({ agent: "tdd-guide", task: "write tests" }),
          success: 1,
          timestamp: "2026-03-20T10:01:00Z",
        },
      ];

      const summary = computeSummary(tools, [], []);

      expect(summary.agents_spawned).toBe(2);
    });

    it("should calculate duration from timestamps", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Read",
          parameters: JSON.stringify({ file_path: "/file1.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file2.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:05:00Z",
        },
      ];

      const summary = computeSummary(tools, [], []);

      expect(summary.duration_ms).toBe(5 * 60 * 1000); // 5 minutes
    });

    it("should sum token usage from queries", () => {
      const queries: SessionQueryData[] = [
        {
          total_tokens: 1000,
          input_tokens: 600,
          output_tokens: 400,
          cost_usd: 0.01,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          total_tokens: 2000,
          input_tokens: 1200,
          output_tokens: 800,
          cost_usd: 0.02,
          timestamp: "2026-03-20T10:01:00Z",
        },
      ];

      const summary = computeSummary([], queries, []);

      expect(summary.total_tokens).toBe(3000);
      expect(summary.total_cost_usd).toBe(0.03);
    });

    it("should detect file deletions from rm commands", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "rm file1.txt" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "rm -rf /path/to/dir" }),
          success: 1,
          timestamp: "2026-03-20T10:01:00Z",
        },
      ];

      const summary = computeSummary(tools, [], []);

      expect(summary.files_deleted).toContain("file1.txt");
      expect(summary.files_deleted).toContain("/path/to/dir");
    });
  });

  describe("computeFlags", () => {
    it("should detect .env in parameters and create critical flag", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Read",
          parameters: JSON.stringify({ file_path: ".env" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);

      const envFlag = flags.find((f) => f.message.includes(".env"));
      expect(envFlag).toBeDefined();
      expect(envFlag?.severity).toBe("critical");
    });

    it("should detect sudo and create critical flag", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "sudo apt-get install package" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);

      const sudoFlag = flags.find((f) => f.message.includes("sudo"));
      expect(sudoFlag).toBeDefined();
      expect(sudoFlag?.severity).toBe("critical");
    });

    it("should detect rm -rf and create critical flag", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "rm -rf /tmp/files" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);

      const rmFlag = flags.find((f) => f.message.includes("rm -rf"));
      expect(rmFlag).toBeDefined();
      expect(rmFlag?.severity).toBe("critical");
    });

    it("should detect chmod 777 and create warning flag", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "chmod 777 file.sh" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);

      const chmodFlag = flags.find((f) => f.message.includes("chmod 777"));
      expect(chmodFlag).toBeDefined();
      expect(chmodFlag?.severity).toBe("warning");
    });

    it("should produce info flag when no tests run", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);

      const noTestsFlag = flags.find((f) => f.message.includes("No tests run"));
      expect(noTestsFlag).toBeDefined();
      expect(noTestsFlag?.severity).toBe("info");
    });

    it("should produce warning for >5 deletions", () => {
      const tools: SessionToolData[] = Array.from({ length: 6 }, (_, i) => ({
        tool_name: "Bash",
        parameters: JSON.stringify({ command: `rm file${i}.txt` }),
        success: 1,
        timestamp: "2026-03-20T10:00:00Z",
      }));
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);

      const deletionsFlag = flags.find((f) => f.message.includes("file deletions"));
      expect(deletionsFlag).toBeDefined();
      expect(deletionsFlag?.severity).toBe("warning");
    });

    it("should produce warning for high failure rate", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 0,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Edit",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 0,
          timestamp: "2026-03-20T10:01:00Z",
        },
        {
          tool_name: "Read",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:02:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);

      const failureFlag = flags.find((f) => f.message.includes("failure rate"));
      expect(failureFlag).toBeDefined();
      expect(failureFlag?.severity).toBe("warning");
    });
  });

  describe("scoreTestCoverage", () => {
    it("should return 0 for no tests", () => {
      const summary = computeSummary([], [], []);
      expect(scoreTestCoverage(summary)).toBe(0);
    });

    it("should return 100 for all tests passed", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "npm test" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      expect(scoreTestCoverage(summary)).toBe(100);
    });

    it("should return proportional score for mixed results", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "npm test" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "npm test" }),
          success: 1,
          timestamp: "2026-03-20T10:01:00Z",
        },
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "npm test" }),
          success: 0,
          timestamp: "2026-03-20T10:02:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      expect(scoreTestCoverage(summary)).toBe(67); // 2/3 = 66.67%, rounded to 67
    });
  });

  describe("scoreScopeDiscipline", () => {
    it("should return 100 for <=3 files", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file1.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file2.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:01:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      expect(scoreScopeDiscipline(summary)).toBe(100);
    });

    it("should decrease for more files", () => {
      const tools: SessionToolData[] = Array.from({ length: 10 }, (_, i) => ({
        tool_name: "Write",
        parameters: JSON.stringify({ file_path: `/file${i}.ts` }),
        success: 1,
        timestamp: "2026-03-20T10:00:00Z",
      }));
      const summary = computeSummary(tools, [], []);
      const score = scoreScopeDiscipline(summary);
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("scoreErrorRate", () => {
    it("should return 100 for no failures", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      expect(scoreErrorRate(summary)).toBe(100);
    });

    it("should return 0 for all failures", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 0,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      expect(scoreErrorRate(summary)).toBe(0);
    });

    it("should return 100 for no tool calls", () => {
      const summary = computeSummary([], [], []);
      expect(scoreErrorRate(summary)).toBe(100);
    });
  });

  describe("scoreCostEfficiency", () => {
    it("should return 100 for low token usage", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const queries: SessionQueryData[] = [
        {
          total_tokens: 3000,
          input_tokens: 2000,
          output_tokens: 1000,
          cost_usd: 0.01,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, queries, []);
      expect(scoreCostEfficiency(summary)).toBe(100);
    });

    it("should return 0 for very high token usage", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const queries: SessionQueryData[] = [
        {
          total_tokens: 60000,
          input_tokens: 40000,
          output_tokens: 20000,
          cost_usd: 0.5,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, queries, []);
      expect(scoreCostEfficiency(summary)).toBe(0);
    });

    it("should return 100 for no successful calls", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 0,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const queries: SessionQueryData[] = [
        {
          total_tokens: 100000,
          input_tokens: 60000,
          output_tokens: 40000,
          cost_usd: 1.0,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, queries, []);
      expect(scoreCostEfficiency(summary)).toBe(100);
    });
  });

  describe("scoreSecurity", () => {
    it("should deduct for critical flags", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Read",
          parameters: JSON.stringify({ file_path: ".env" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);
      const score = scoreSecurity(summary, flags);
      expect(score).toBeLessThan(100);
    });

    it("should return 100 for no security issues", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const summary = computeSummary(tools, [], []);
      const flags = computeFlags(summary, tools);
      const score = scoreSecurity(summary, flags);
      expect(score).toBe(100);
    });
  });

  describe("computeTrustScore", () => {
    it("should return correct overall weighted average", () => {
      const tools: SessionToolData[] = [
        {
          tool_name: "Write",
          parameters: JSON.stringify({ file_path: "/file.ts" }),
          success: 1,
          timestamp: "2026-03-20T10:00:00Z",
        },
        {
          tool_name: "Bash",
          parameters: JSON.stringify({ command: "npm test" }),
          success: 1,
          timestamp: "2026-03-20T10:01:00Z",
        },
      ];
      const queries: SessionQueryData[] = [
        {
          total_tokens: 3000,
          input_tokens: 2000,
          output_tokens: 1000,
          cost_usd: 0.01,
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];
      const conversations: SessionConversationData[] = [
        {
          role: "user",
          content: "Implement feature X",
          timestamp: "2026-03-20T10:00:00Z",
        },
      ];

      const metrics = computeTrustScore("test-session", tools, queries, conversations);

      expect(metrics.session_id).toBe("test-session");
      expect(metrics.overall_score).toBeGreaterThanOrEqual(0);
      expect(metrics.overall_score).toBeLessThanOrEqual(100);
      expect(metrics.dimensions.test_coverage).toBe(100);
      expect(metrics.dimensions.scope_discipline).toBe(100);
      expect(metrics.dimensions.error_rate).toBe(100);
      expect(metrics.dimensions.cost_efficiency).toBe(100);
      expect(metrics.dimensions.security).toBe(100);
    });

    it("should return correct structure with all required fields", () => {
      const metrics = computeTrustScore("test-session", [], [], []);

      expect(metrics).toHaveProperty("session_id");
      expect(metrics).toHaveProperty("overall_score");
      expect(metrics).toHaveProperty("dimensions");
      expect(metrics).toHaveProperty("summary");
      expect(metrics).toHaveProperty("flags");

      expect(metrics.dimensions).toHaveProperty("test_coverage");
      expect(metrics.dimensions).toHaveProperty("scope_discipline");
      expect(metrics.dimensions).toHaveProperty("error_rate");
      expect(metrics.dimensions).toHaveProperty("cost_efficiency");
      expect(metrics.dimensions).toHaveProperty("security");

      expect(metrics.summary).toHaveProperty("files_touched");
      expect(metrics.summary).toHaveProperty("files_created");
      expect(metrics.summary).toHaveProperty("files_deleted");
      expect(metrics.summary).toHaveProperty("tests_run");
      expect(metrics.summary).toHaveProperty("tests_passed");
      expect(metrics.summary).toHaveProperty("tests_failed");
      expect(metrics.summary).toHaveProperty("total_tool_calls");
      expect(metrics.summary).toHaveProperty("failed_tool_calls");
      expect(metrics.summary).toHaveProperty("total_tokens");
      expect(metrics.summary).toHaveProperty("total_cost_usd");
      expect(metrics.summary).toHaveProperty("duration_ms");
      expect(metrics.summary).toHaveProperty("agents_spawned");
      expect(metrics.summary).toHaveProperty("security_flags");

      expect(Array.isArray(metrics.flags)).toBe(true);
    });
  });
});
