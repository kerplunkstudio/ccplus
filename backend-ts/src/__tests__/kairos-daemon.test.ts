import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as kairosDb from "../db/kairos.js";
import * as kairosRunner from "../kairos-runner.js";
import * as kairosPatcher from "../kairos-prompt-patcher.js";
import {
  startKairosDaemon,
  stopKairosDaemon,
  getKairosDaemonState,
  triggerManualAnalysis,
  __resetStateForTesting,
} from "../kairos-daemon.js";

// Mock dependencies
vi.mock("../db/kairos.js");
vi.mock("../kairos-runner.js");
vi.mock("../kairos-prompt-patcher.js");

describe("kairos-daemon", () => {
  const mockLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stopKairosDaemon(); // Ensure daemon is stopped before each test
    __resetStateForTesting(); // Reset state counters
  });

  afterEach(() => {
    stopKairosDaemon(); // Clean up after tests
  });

  describe("startKairosDaemon", () => {
    it("starts the daemon successfully", () => {
      startKairosDaemon({ log: mockLog });

      const state = getKairosDaemonState();
      expect(state.running).toBe(true);
      expect(state.analyzing).toBe(false);
      expect(state.tickCount).toBe(0);
    });

    it("does not start daemon twice", () => {
      startKairosDaemon({ log: mockLog });
      startKairosDaemon({ log: mockLog });

      expect(mockLog.warn).toHaveBeenCalledWith("KAIROS daemon already running");
    });
  });

  describe("stopKairosDaemon", () => {
    it("stops the daemon successfully", () => {
      startKairosDaemon({ log: mockLog });
      stopKairosDaemon();

      const state = getKairosDaemonState();
      expect(state.running).toBe(false);
    });
  });

  describe("getKairosDaemonState", () => {
    it("returns immutable copy of state", () => {
      const state1 = getKairosDaemonState();
      const state2 = getKairosDaemonState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2); // Different object references
    });
  });

  describe("triggerManualAnalysis", () => {
    const mockSessionIds = ["session1", "session2", "session3"];
    const mockAnalysisResult = {
      analyzed: 3,
      correlationsFound: 2,
      promptChangesRecommended: 1,
      totalTokens: 1000,
      durationMs: 5000,
      promptChanges: [
        {
          targetFile: "/path/to/agent.md",
          section: "## Instructions",
          changeType: "addition",
          currentText: "",
          proposedText: "New instruction line",
          reasoning: "Test reasoning",
          evidenceSessionIds: ["session1"],
          confidence: 0.8,
        },
      ],
    };

    beforeEach(() => {
      vi.mocked(kairosRunner.runKairosAnalysis).mockResolvedValue(mockAnalysisResult);
      vi.mocked(kairosPatcher.applyPromptChange).mockReturnValue({
        changeId: 1,
        applied: true,
      });
    });

    it("runs manual analysis successfully", async () => {
      await triggerManualAnalysis(mockSessionIds, { log: mockLog });

      expect(kairosRunner.runKairosAnalysis).toHaveBeenCalledWith(mockSessionIds, { log: mockLog });

      const state = getKairosDaemonState();
      expect(state.analyzing).toBe(false);
      expect(state.totalAnalyzed).toBe(3);
      expect(state.totalCorrelations).toBe(2);
      expect(state.lastAnalysisAt).toBeTruthy();
    });

    it("rejects concurrent manual analysis", async () => {
      const promise1 = triggerManualAnalysis(mockSessionIds, { log: mockLog });

      await expect(triggerManualAnalysis(mockSessionIds, { log: mockLog })).rejects.toThrow(
        "KAIROS analysis already in progress"
      );

      await promise1;
    });

    it("rejects empty session list", async () => {
      await expect(triggerManualAnalysis([], { log: mockLog })).rejects.toThrow(
        "No sessions provided for analysis"
      );
    });

    it("applies prompt changes with sufficient confidence", async () => {
      await triggerManualAnalysis(mockSessionIds, { log: mockLog });

      expect(kairosPatcher.applyPromptChange).toHaveBeenCalledWith({
        targetFile: "/path/to/agent.md",
        section: "## Instructions",
        changeType: "addition",
        currentText: "",
        proposedText: "New instruction line",
        reasoning: "Test reasoning",
        evidenceSessionIds: ["session1"],
        confidence: 0.8,
      });

      const state = getKairosDaemonState();
      expect(state.totalPromptChanges).toBe(1);
    });

    it("skips prompt changes below confidence threshold", async () => {
      const lowConfidenceResult = {
        ...mockAnalysisResult,
        promptChanges: [
          {
            ...mockAnalysisResult.promptChanges[0],
            confidence: 0.5, // Below 0.6 threshold
          },
        ],
      };

      vi.mocked(kairosRunner.runKairosAnalysis).mockResolvedValue(lowConfidenceResult);

      await triggerManualAnalysis(mockSessionIds, { log: mockLog });

      expect(kairosPatcher.applyPromptChange).not.toHaveBeenCalled();

      const state = getKairosDaemonState();
      expect(state.totalPromptChanges).toBe(0);
    });

    it("handles analysis errors gracefully", async () => {
      const errorMessage = "Analysis failed due to API timeout";
      vi.mocked(kairosRunner.runKairosAnalysis).mockRejectedValue(new Error(errorMessage));

      await expect(triggerManualAnalysis(mockSessionIds, { log: mockLog })).rejects.toThrow(
        errorMessage
      );

      expect(mockLog.error).toHaveBeenCalledWith("KAIROS manual analysis failed", {
        error: `Error: ${errorMessage}`,
      });

      const state = getKairosDaemonState();
      expect(state.analyzing).toBe(false); // Flag cleared after error
    });

    it("updates state counters correctly", async () => {
      // Run analysis once
      await triggerManualAnalysis(mockSessionIds, { log: mockLog });

      const state1 = getKairosDaemonState();
      expect(state1.totalAnalyzed).toBe(3);
      expect(state1.totalCorrelations).toBe(2);
      expect(state1.totalPromptChanges).toBe(1);

      // Run again to verify accumulation
      await triggerManualAnalysis(mockSessionIds, { log: mockLog });

      const state2 = getKairosDaemonState();
      expect(state2.totalAnalyzed).toBe(6);
      expect(state2.totalCorrelations).toBe(4);
      expect(state2.totalPromptChanges).toBe(2);
    });
  });

  describe("automatic tick behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("skips analysis when not enough sessions", async () => {
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["session1", "session2"]); // Only 2 (< 3 threshold)

      startKairosDaemon({ log: mockLog });

      // Advance past one tick
      await vi.advanceTimersByTimeAsync(900000); // 15 minutes

      expect(kairosRunner.runKairosAnalysis).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        "KAIROS daemon tick: not enough sessions to analyze",
        expect.objectContaining({
          found: 2,
          required: 3,
        })
      );
    });

    it("runs analysis when threshold is met", async () => {
      const mockSessionIds = ["session1", "session2", "session3", "session4", "session5"];
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(mockSessionIds);
      vi.mocked(kairosRunner.runKairosAnalysis).mockResolvedValue({
        analyzed: 5,
        correlationsFound: 3,
        promptChangesRecommended: 0,
        totalTokens: 2000,
        durationMs: 10000,
        promptChanges: [],
      });

      startKairosDaemon({ log: mockLog });

      // Advance past one tick
      await vi.advanceTimersByTimeAsync(900000);

      expect(kairosRunner.runKairosAnalysis).toHaveBeenCalledWith(mockSessionIds, { log: mockLog });
    });

    it("skips tick if analysis is already in progress", async () => {
      const mockSessionIds = ["session1", "session2", "session3"];
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(mockSessionIds);

      // Make analysis take a long time (longer than tick interval)
      vi.mocked(kairosRunner.runKairosAnalysis).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000000))
      );

      startKairosDaemon({ log: mockLog });

      // Trigger first tick
      await vi.advanceTimersByTimeAsync(900000);

      // Trigger second tick (should be skipped)
      await vi.advanceTimersByTimeAsync(900000);

      expect(mockLog.info).toHaveBeenCalledWith(
        "KAIROS daemon tick skipped: analysis already in progress"
      );
    });
  });
});
