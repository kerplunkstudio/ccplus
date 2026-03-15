import { existsSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  DATABASE_PATH,
  DATA_DIR,
  LOCAL_MODE,
  LOG_DIR,
  MAX_ACTIVITY_EVENTS,
  MAX_CONVERSATION_HISTORY,
  PROJECT_ROOT,
} from "../config.js";

describe("Config", () => {
  describe("directory structure", () => {
    it("should have PROJECT_ROOT with backend-ts subdirectory", () => {
      expect(existsSync(PROJECT_ROOT)).toBe(true);
      // backend-ts is inside PROJECT_ROOT
      const backendPath = PROJECT_ROOT + "/backend-ts";
      expect(existsSync(backendPath)).toBe(true);
    });

    it("should create DATA_DIR", () => {
      expect(existsSync(DATA_DIR)).toBe(true);
    });

    it("should create LOG_DIR", () => {
      expect(existsSync(LOG_DIR)).toBe(true);
    });
  });

  describe("default values", () => {
    it("should have correct constants", () => {
      expect(MAX_CONVERSATION_HISTORY).toBe(50);
      expect(MAX_ACTIVITY_EVENTS).toBe(200);
    });

    it("should have DATABASE_PATH containing ccplus.db", () => {
      expect(DATABASE_PATH).toContain("ccplus.db");
    });
  });

  describe("local mode", () => {
    it("should default to LOCAL_MODE true", () => {
      expect(LOCAL_MODE).toBe(true);
    });
  });
});
