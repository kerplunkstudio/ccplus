import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import {
  getUnanalyzedSessionIds,
  ensureAnalysisRecord,
  markAnalysisStarted,
  markAnalysisCompleted,
  markAnalysisFailed,
  getAnalysis,
  getAnalyses,
  addCorrelation,
  getCorrelationsForSession,
  getCorrelationChain,
  recordPromptChange,
  markPromptChangeRolledBack,
  getPromptChangeHistory,
  getActivePromptChanges,
} from "../db/kairos.js";

// Mock the connection module
let testDb: Database.Database;

vi.mock("../db/connection.js", () => ({
  getDb: () => testDb,
}));

describe("KAIROS Database Layer", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    applyMigrations(testDb);

    // Insert test fleet sessions
    testDb.prepare(`
      INSERT INTO fleet_sessions (session_id, status, workspace, started_at, last_activity)
      VALUES
        ('session-1', 'completed', '/test', '2026-01-01 10:00:00', '2026-01-01 10:05:00'),
        ('session-2', 'failed', '/test', '2026-01-01 11:00:00', '2026-01-01 11:05:00'),
        ('session-3', 'running', '/test', '2026-01-01 12:00:00', '2026-01-01 12:05:00')
    `).run();
  });

  describe("Analysis Functions", () => {
    it("should get unanalyzed session IDs", () => {
      const unanalyzed = getUnanalyzedSessionIds(10);
      expect(unanalyzed).toHaveLength(2);
      expect(unanalyzed).toContain("session-1");
      expect(unanalyzed).toContain("session-2");
      expect(unanalyzed).not.toContain("session-3"); // running status excluded
    });

    it("should ensure analysis record exists", () => {
      ensureAnalysisRecord("session-1");
      const analysis = getAnalysis("session-1");
      expect(analysis).toBeTruthy();
      expect(analysis?.session_id).toBe("session-1");
      expect(analysis?.status).toBe("pending");
    });

    it("should mark analysis as started", () => {
      ensureAnalysisRecord("session-1");
      markAnalysisStarted("session-1", "claude-opus-4-20250514");
      const analysis = getAnalysis("session-1");
      expect(analysis?.status).toBe("analyzing");
      expect(analysis?.analysis_model).toBe("claude-opus-4-20250514");
    });

    it("should mark analysis as completed with full data", () => {
      ensureAnalysisRecord("session-1");
      markAnalysisStarted("session-1", "claude-opus-4-20250514");
      markAnalysisCompleted("session-1", {
        taskIntent: "Fix bug in authentication",
        actualOutcome: "partial_success",
        outcomeReasoning: "Fixed the immediate bug but introduced a new edge case",
        followUpNeeded: true,
        correlatedWith: ["session-0"],
        promptIssues: [{ type: "unclear_constraint", evidence: "Missing rate limit guidance" }],
        recommendations: [{ action: "add_guidance", target: "auth prompt" }],
        analysisTokens: 5000,
        analysisCostUsd: 0.05,
        analysisDurationMs: 1200,
      });

      const analysis = getAnalysis("session-1");
      expect(analysis?.status).toBe("completed");
      expect(analysis?.task_intent).toBe("Fix bug in authentication");
      expect(analysis?.actual_outcome).toBe("partial_success");
      expect(analysis?.follow_up_needed).toBe(1);
      expect(analysis?.correlated_with).toBe('["session-0"]');
      expect(analysis?.analysis_tokens).toBe(5000);
      expect(analysis?.analyzed_at).toBeTruthy();
    });

    it("should mark analysis as failed with error", () => {
      ensureAnalysisRecord("session-1");
      markAnalysisStarted("session-1", "claude-opus-4-20250514");
      markAnalysisFailed("session-1", "API timeout");

      const analysis = getAnalysis("session-1");
      expect(analysis?.status).toBe("failed");
      expect(analysis?.error).toBe("API timeout");
      expect(analysis?.analyzed_at).toBeTruthy();
    });

    it("should get analyses with filters", () => {
      ensureAnalysisRecord("session-1");
      markAnalysisCompleted("session-1", {
        taskIntent: "Test",
        actualOutcome: "success",
        outcomeReasoning: "Done",
        followUpNeeded: false,
        correlatedWith: [],
        promptIssues: [],
        recommendations: [],
        analysisTokens: 100,
        analysisCostUsd: 0.01,
        analysisDurationMs: 100,
      });

      ensureAnalysisRecord("session-2");
      markAnalysisFailed("session-2", "Error");

      const completed = getAnalyses({ status: "completed" });
      expect(completed).toHaveLength(1);
      expect(completed[0].session_id).toBe("session-1");

      const failed = getAnalyses({ status: "failed" });
      expect(failed).toHaveLength(1);
      expect(failed[0].session_id).toBe("session-2");
    });

    it("should not create duplicate analysis records", () => {
      ensureAnalysisRecord("session-1");
      ensureAnalysisRecord("session-1");
      const analyses = getAnalyses({ status: "pending" });
      expect(analyses.filter((a) => a.session_id === "session-1")).toHaveLength(1);
    });
  });

  describe("Correlation Functions", () => {
    it("should add correlation between sessions", () => {
      addCorrelation({
        sourceSessionId: "session-1",
        targetSessionId: "session-2",
        relationType: "bug_fix_chain",
        confidence: 0.95,
        evidence: "Session-2 references bug from session-1",
      });

      const correlations = getCorrelationsForSession("session-1");
      expect(correlations).toHaveLength(1);
      expect(correlations[0].source_session_id).toBe("session-1");
      expect(correlations[0].target_session_id).toBe("session-2");
      expect(correlations[0].relation_type).toBe("bug_fix_chain");
      expect(correlations[0].confidence).toBe(0.95);
    });

    it("should get correlations for both source and target", () => {
      addCorrelation({
        sourceSessionId: "session-1",
        targetSessionId: "session-2",
        relationType: "bug_fix_chain",
        confidence: 1.0,
        evidence: "Direct follow-up",
      });

      const session1Corr = getCorrelationsForSession("session-1");
      const session2Corr = getCorrelationsForSession("session-2");

      expect(session1Corr).toHaveLength(1);
      expect(session2Corr).toHaveLength(1);
    });

    it("should follow correlation chain recursively", () => {
      // Create chain: session-1 -> session-2 -> session-3
      addCorrelation({
        sourceSessionId: "session-1",
        targetSessionId: "session-2",
        relationType: "bug_fix_chain",
        confidence: 1.0,
        evidence: "First fix",
      });

      addCorrelation({
        sourceSessionId: "session-2",
        targetSessionId: "session-3",
        relationType: "bug_fix_chain",
        confidence: 1.0,
        evidence: "Second fix",
      });

      const chain = getCorrelationChain("session-1");
      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(chain.some((c) => c.source_session_id === "session-1")).toBe(true);
      expect(chain.some((c) => c.source_session_id === "session-2")).toBe(true);
    });

    it("should not create duplicate correlations", () => {
      addCorrelation({
        sourceSessionId: "session-1",
        targetSessionId: "session-2",
        relationType: "bug_fix_chain",
        confidence: 1.0,
        evidence: "Test",
      });

      addCorrelation({
        sourceSessionId: "session-1",
        targetSessionId: "session-2",
        relationType: "bug_fix_chain",
        confidence: 0.9,
        evidence: "Duplicate",
      });

      const correlations = getCorrelationsForSession("session-1");
      expect(correlations).toHaveLength(1);
    });
  });

  describe("Prompt Change Functions", () => {
    it("should record prompt change", () => {
      const changeId = recordPromptChange({
        filePath: "/agents/code_agent.md",
        changeType: "constraint_addition",
        diffBefore: "Old prompt text",
        diffAfter: "New prompt text with constraint",
        evidenceSessionIds: ["session-1", "session-2"],
        reasoning: "Sessions consistently failed due to missing constraint",
      });

      expect(changeId).toBeGreaterThan(0);

      const history = getPromptChangeHistory("/agents/code_agent.md");
      expect(history).toHaveLength(1);
      expect(history[0].file_path).toBe("/agents/code_agent.md");
      expect(history[0].change_type).toBe("constraint_addition");
      expect(history[0].applied).toBe(1);
      expect(history[0].rolled_back_at).toBeNull();
    });

    it("should mark change as rolled back", () => {
      const changeId = recordPromptChange({
        filePath: "/agents/code_agent.md",
        changeType: "constraint_addition",
        diffBefore: "Old",
        diffAfter: "New",
        evidenceSessionIds: ["session-1"],
        reasoning: "Test change",
      });

      markPromptChangeRolledBack(changeId, "Change caused regression");

      const history = getPromptChangeHistory("/agents/code_agent.md");
      expect(history[0].applied).toBe(0);
      expect(history[0].rollback_reason).toBe("Change caused regression");
      expect(history[0].rolled_back_at).toBeTruthy();
    });

    it("should get only active changes", () => {
      const changeId1 = recordPromptChange({
        filePath: "/agents/code_agent.md",
        changeType: "fix",
        diffBefore: "Old",
        diffAfter: "New",
        evidenceSessionIds: ["session-1"],
        reasoning: "Active change",
      });

      const changeId2 = recordPromptChange({
        filePath: "/agents/planner.md",
        changeType: "enhancement",
        diffBefore: "Old",
        diffAfter: "New",
        evidenceSessionIds: ["session-2"],
        reasoning: "Another active change",
      });

      markPromptChangeRolledBack(changeId2, "Rolled back");

      const active = getActivePromptChanges();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(changeId1);
    });

    it("should filter history by file path", () => {
      recordPromptChange({
        filePath: "/agents/code_agent.md",
        changeType: "fix",
        diffBefore: "Old",
        diffAfter: "New",
        evidenceSessionIds: ["session-1"],
        reasoning: "Fix 1",
      });

      recordPromptChange({
        filePath: "/agents/planner.md",
        changeType: "fix",
        diffBefore: "Old",
        diffAfter: "New",
        evidenceSessionIds: ["session-2"],
        reasoning: "Fix 2",
      });

      const codeAgentHistory = getPromptChangeHistory("/agents/code_agent.md");
      expect(codeAgentHistory).toHaveLength(1);
      expect(codeAgentHistory[0].file_path).toBe("/agents/code_agent.md");

      const allHistory = getPromptChangeHistory();
      expect(allHistory).toHaveLength(2);
    });

    it("should limit history results", () => {
      for (let i = 0; i < 5; i++) {
        recordPromptChange({
          filePath: "/agents/code_agent.md",
          changeType: "fix",
          diffBefore: `Old ${i}`,
          diffAfter: `New ${i}`,
          evidenceSessionIds: [`session-${i}`],
          reasoning: `Fix ${i}`,
        });
      }

      const limited = getPromptChangeHistory(undefined, 3);
      expect(limited).toHaveLength(3);
    });
  });
});
