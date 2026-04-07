import { describe, it, expect, vi, beforeEach } from "vitest";
import * as kairosDb from "../db/kairos.js";
import {
  checkKairos,
  onKairosSessionComplete,
  startKairosDaemon,
  stopKairosDaemon,
  getKairosDaemonState,
  getKairosState,
  __resetStateForTesting,
} from "../kairos-daemon.js";
import type { KairosDeps } from "../kairos-daemon.js";

vi.mock("../db/kairos.js");

function makeDeps(overrides?: Partial<KairosDeps>): KairosDeps {
  return {
    sendCaptainMessage: vi.fn(),
    isCaptainAlive: vi.fn(() => true),
    getActiveSessionCount: vi.fn(() => 0),
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    ...overrides,
  };
}

describe("kairos-daemon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStateForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("startKairosDaemon", () => {
    it("enables KAIROS and logs config", () => {
      const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      startKairosDaemon({ log });

      const state = getKairosDaemonState();
      expect(state.enabled).toBe(true);
      expect(log.info).toHaveBeenCalledWith("KAIROS enabled", expect.any(Object));
    });
  });

  describe("stopKairosDaemon", () => {
    it("disables KAIROS", () => {
      const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      startKairosDaemon({ log });
      stopKairosDaemon();

      const state = getKairosDaemonState();
      expect(state.enabled).toBe(false);
    });
  });

  describe("getKairosState / getKairosDaemonState", () => {
    it("returns immutable copy of state", () => {
      const state1 = getKairosState();
      const state2 = getKairosState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });

    it("getKairosDaemonState is an alias for getKairosState", () => {
      expect(getKairosDaemonState()).toEqual(getKairosState());
    });
  });

  describe("checkKairos", () => {
    it("does nothing when KAIROS is disabled", () => {
      const deps = makeDeps();
      checkKairos(deps);

      expect(kairosDb.getUnanalyzedSessionIds).not.toHaveBeenCalled();
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();
    });

    it("does nothing when Captain is not alive", () => {
      const deps = makeDeps({ isCaptainAlive: vi.fn(() => false) });
      startKairosDaemon({ log: deps.log });

      checkKairos(deps);

      expect(kairosDb.getUnanalyzedSessionIds).not.toHaveBeenCalled();
    });

    it("does nothing when Captain is not idle", () => {
      const deps = makeDeps({ isCaptainIdle: vi.fn(() => false) });
      startKairosDaemon({ log: deps.log });

      checkKairos(deps);

      expect(kairosDb.getUnanalyzedSessionIds).not.toHaveBeenCalled();
    });

    it("does nothing when not enough sessions", () => {
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1"]);

      checkKairos(deps);

      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();
    });

    it("triggers analysis when enough sessions exist and idle > 10 min", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      // First tick — start idle timer
      checkKairos(deps);
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();

      // Advance past 10 minutes
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps);

      expect(deps.sendCaptainMessage).toHaveBeenCalledWith(
        expect.stringContaining("[FLEET][AUTO]"),
        "fleet",
        "kairos"
      );

      const state = getKairosState();
      expect(state.analyzing).toBe(true);
      expect(state.totalBatchesTriggered).toBe(1);

    });

    it("marks sessions analyzed at trigger time (before sending Captain message)", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      const sessionIds = ["s1", "s2", "s3", "s4", "s5"];
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(sessionIds);

      // First tick — start idle timer
      checkKairos(deps);
      expect(kairosDb.markSessionsAnalyzed).not.toHaveBeenCalled();

      // Advance past 10 minutes — trigger fires
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps);

      expect(kairosDb.markSessionsAnalyzed).toHaveBeenCalledWith(sessionIds);
      // markSessionsAnalyzed must be called before sendCaptainMessage
      const markOrder = vi.mocked(kairosDb.markSessionsAnalyzed).mock.invocationCallOrder[0];
      const sendOrder = vi.mocked(deps.sendCaptainMessage).mock.invocationCallOrder[0];
      expect(markOrder).toBeLessThan(sendOrder);
    });

    it("skips when analysis is already in progress", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      // First tick and wait 11 minutes to trigger
      checkKairos(deps);
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps); // triggers

      checkKairos(deps); // should skip

      expect(deps.sendCaptainMessage).toHaveBeenCalledTimes(1);

    });

    it("increments checkCount on each call", () => {
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });

      checkKairos(deps);
      checkKairos(deps);
      checkKairos(deps);

      const state = getKairosState();
      expect(state.checkCount).toBe(3);
    });

    it("handles errors gracefully", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockImplementation(() => {
        throw new Error("DB error");
      });

      checkKairos(deps);
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps);

      expect(deps.log.error).toHaveBeenCalledWith("KAIROS: check failed", {
        error: "Error: DB error",
      });

    });

    it("does not trigger before 10 minutes of idle time", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      // First tick — Captain becomes idle, start tracking
      checkKairos(deps);
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();

      // Advance 9 minutes — still should not trigger
      vi.advanceTimersByTime(9 * 60 * 1000);
      checkKairos(deps);
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();

    });

    it("triggers after 10 minutes of continuous idle time", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      // First tick — Captain becomes idle
      checkKairos(deps);
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();

      // Advance 11 minutes — should trigger
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps);
      expect(deps.sendCaptainMessage).toHaveBeenCalledWith(
        expect.stringContaining("[FLEET][AUTO]"),
        "fleet",
        "kairos"
      );

    });

    it("resets idle timer when Captain becomes busy", () => {
      vi.useFakeTimers();
      const isCaptainIdleMock = vi.fn(() => true);
      const deps = makeDeps({ isCaptainIdle: isCaptainIdleMock });
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      // First tick — Captain becomes idle
      checkKairos(deps);

      // Advance 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);
      checkKairos(deps);

      // Captain becomes busy
      isCaptainIdleMock.mockReturnValue(false);
      checkKairos(deps);

      // Captain becomes idle again
      isCaptainIdleMock.mockReturnValue(true);
      checkKairos(deps);

      // Advance 9 minutes (should not trigger yet because timer was reset)
      vi.advanceTimersByTime(9 * 60 * 1000);
      checkKairos(deps);
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();

      // Advance 2 more minutes (total 11 minutes since last idle)
      vi.advanceTimersByTime(2 * 60 * 1000);
      checkKairos(deps);
      expect(deps.sendCaptainMessage).toHaveBeenCalledWith(
        expect.stringContaining("[FLEET][AUTO]"),
        "fleet",
        "kairos"
      );

    });

    it("skips when active sessions exist", () => {
      const deps = makeDeps({ getActiveSessionCount: vi.fn(() => 2) });
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      checkKairos(deps);

      expect(deps.log.info).toHaveBeenCalledWith(
        "KAIROS: skipping — fleet has active sessions",
        { activeCount: 2 }
      );
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();
    });

    it("triggers when no active sessions and all other conditions met", () => {
      const deps = makeDeps({ getActiveSessionCount: vi.fn(() => 0) });
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      checkKairos(deps);

      expect(deps.sendCaptainMessage).toHaveBeenCalledWith(
        expect.stringContaining("[FLEET][AUTO]"),
        "fleet",
        "kairos"
      );

      const state = getKairosState();
      expect(state.analyzing).toBe(true);
    });
  });

  describe("onKairosSessionComplete", () => {
    it("resets analyzing flag", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      checkKairos(deps);
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps);
      expect(getKairosState().analyzing).toBe(true);

      onKairosSessionComplete();
      expect(getKairosState().analyzing).toBe(false);

    });

    it("resets idle timer so KAIROS requires another 10 minutes before re-triggering", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      // First tick — Captain becomes idle, idle timer starts
      checkKairos(deps);
      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();

      // Advance 11 minutes — KAIROS triggers
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps);
      expect(deps.sendCaptainMessage).toHaveBeenCalledTimes(1);
      expect(getKairosState().analyzing).toBe(true);

      // Complete the session — idle timer resets
      onKairosSessionComplete();
      expect(getKairosState().analyzing).toBe(false);

      // First post-completion check — Captain still idle, idle timer starts fresh from here
      checkKairos(deps);
      expect(deps.sendCaptainMessage).toHaveBeenCalledTimes(1);

      // Advance 9 minutes from the post-completion check — should NOT re-trigger
      vi.advanceTimersByTime(9 * 60 * 1000);
      checkKairos(deps);
      expect(deps.sendCaptainMessage).toHaveBeenCalledTimes(1);

      // Advance 2 more minutes (total 11 since idle timer restarted) — SHOULD re-trigger
      vi.advanceTimersByTime(2 * 60 * 1000);
      checkKairos(deps);
      expect(deps.sendCaptainMessage).toHaveBeenCalledTimes(2);
      expect(getKairosState().totalBatchesTriggered).toBe(2);

    });

    it("does not call markSessionsAnalyzed on complete (already done at trigger time)", () => {
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      checkKairos(deps);
      vi.clearAllMocks();

      onKairosSessionComplete();

      expect(kairosDb.markSessionsAnalyzed).not.toHaveBeenCalled();
    });
  });

  describe("__resetStateForTesting", () => {
    it("resets all state to defaults", () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);
      checkKairos(deps);
      vi.advanceTimersByTime(11 * 60 * 1000);
      checkKairos(deps);

      __resetStateForTesting();

      const state = getKairosState();
      expect(state.enabled).toBe(false);
      expect(state.analyzing).toBe(false);
      expect(state.checkCount).toBe(0);
      expect(state.totalBatchesTriggered).toBe(0);

    });
  });
});
