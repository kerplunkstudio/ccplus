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

    it("does nothing when not enough sessions", () => {
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1"]);

      checkKairos(deps);

      expect(deps.sendCaptainMessage).not.toHaveBeenCalled();
    });

    it("triggers analysis when enough sessions exist", () => {
      const deps = makeDeps();
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
      expect(state.totalBatchesTriggered).toBe(1);
    });

    it("skips when analysis is already in progress", () => {
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

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
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockImplementation(() => {
        throw new Error("DB error");
      });

      checkKairos(deps);

      expect(deps.log.error).toHaveBeenCalledWith("KAIROS: check failed", {
        error: "Error: DB error",
      });
    });
  });

  describe("onKairosSessionComplete", () => {
    it("resets analyzing flag", () => {
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);

      checkKairos(deps);
      expect(getKairosState().analyzing).toBe(true);

      onKairosSessionComplete();
      expect(getKairosState().analyzing).toBe(false);
    });
  });

  describe("__resetStateForTesting", () => {
    it("resets all state to defaults", () => {
      const deps = makeDeps();
      startKairosDaemon({ log: deps.log });
      vi.mocked(kairosDb.getUnanalyzedSessionIds).mockReturnValue(["s1", "s2", "s3", "s4", "s5"]);
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
