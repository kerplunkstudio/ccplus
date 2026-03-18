import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import { ConfigWatcher, HOT_RELOADABLE_KEYS, RESTART_REQUIRED_KEYS, type ConfigChange } from "../config-watcher.js";

describe("ConfigWatcher", () => {
  let testEnvPath: string;
  let watcher: ConfigWatcher;

  beforeEach(() => {
    // Create a temporary .env file for testing
    testEnvPath = path.join(tmpdir(), `test-env-${Date.now()}.env`);
    writeFileSync(testEnvPath, "SDK_MODEL=sonnet\nPORT=4000\n");
    watcher = new ConfigWatcher(testEnvPath);
  });

  afterEach(() => {
    // Clean up
    watcher.stop();
    if (existsSync(testEnvPath)) {
      unlinkSync(testEnvPath);
    }
  });

  describe("readEnvFile", () => {
    it("should parse basic KEY=VALUE format", () => {
      const config = watcher.getConfig();
      expect(config.SDK_MODEL).toBe("sonnet");
      expect(config.PORT).toBe("4000");
    });

    it("should handle quoted values", () => {
      writeFileSync(testEnvPath, 'SECRET_KEY="my secret key"\nNAME=\'John Doe\'\n');
      watcher = new ConfigWatcher(testEnvPath);
      const config = watcher.getConfig();
      expect(config.SECRET_KEY).toBe("my secret key");
      expect(config.NAME).toBe("John Doe");
    });

    it("should skip empty lines and comments", () => {
      writeFileSync(testEnvPath, "# Comment\nSDK_MODEL=sonnet\n\n# Another comment\nPORT=4000\n");
      watcher = new ConfigWatcher(testEnvPath);
      const config = watcher.getConfig();
      expect(config.SDK_MODEL).toBe("sonnet");
      expect(config.PORT).toBe("4000");
    });

    it("should handle lines without equals sign", () => {
      writeFileSync(testEnvPath, "VALID=value\nINVALID_LINE\nANOTHER_VALID=123\n");
      watcher = new ConfigWatcher(testEnvPath);
      const config = watcher.getConfig();
      expect(config.VALID).toBe("value");
      expect(config.INVALID_LINE).toBeUndefined();
      expect(config.ANOTHER_VALID).toBe("123");
    });

    it("should return empty config for nonexistent file", () => {
      const nonexistentPath = path.join(tmpdir(), "nonexistent-env-file.env");
      const emptyWatcher = new ConfigWatcher(nonexistentPath);
      const config = emptyWatcher.getConfig();
      expect(config).toEqual({});
    });
  });

  describe("detectChanges", () => {
    it("should detect added keys", () => {
      writeFileSync(testEnvPath, "SDK_MODEL=sonnet\n");
      watcher = new ConfigWatcher(testEnvPath);

      writeFileSync(testEnvPath, "SDK_MODEL=sonnet\nNEW_KEY=value\n");
      const newConfig = new ConfigWatcher(testEnvPath).getConfig();

      const changes = (watcher as any).detectChanges(watcher.getConfig(), newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].key).toBe("NEW_KEY");
      expect(changes[0].oldValue).toBeUndefined();
      expect(changes[0].newValue).toBe("value");
    });

    it("should detect removed keys", () => {
      writeFileSync(testEnvPath, "SDK_MODEL=sonnet\nREMOVED_KEY=value\n");
      watcher = new ConfigWatcher(testEnvPath);
      const oldConfig = watcher.getConfig();

      writeFileSync(testEnvPath, "SDK_MODEL=sonnet\n");
      const newConfig = new ConfigWatcher(testEnvPath).getConfig();

      const changes = (watcher as any).detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].key).toBe("REMOVED_KEY");
      expect(changes[0].oldValue).toBe("value");
      expect(changes[0].newValue).toBeUndefined();
    });

    it("should detect changed values", () => {
      writeFileSync(testEnvPath, "SDK_MODEL=sonnet\n");
      watcher = new ConfigWatcher(testEnvPath);
      const oldConfig = watcher.getConfig();

      writeFileSync(testEnvPath, "SDK_MODEL=opus\n");
      const newConfig = new ConfigWatcher(testEnvPath).getConfig();

      const changes = (watcher as any).detectChanges(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].key).toBe("SDK_MODEL");
      expect(changes[0].oldValue).toBe("sonnet");
      expect(changes[0].newValue).toBe("opus");
    });

    it("should classify hot-reloadable keys correctly", () => {
      writeFileSync(testEnvPath, "SDK_MODEL=sonnet\n");
      watcher = new ConfigWatcher(testEnvPath);
      const oldConfig = watcher.getConfig();

      writeFileSync(testEnvPath, "SDK_MODEL=opus\n");
      const newConfig = new ConfigWatcher(testEnvPath).getConfig();

      const changes = (watcher as any).detectChanges(oldConfig, newConfig);

      expect(changes[0].hotReloadable).toBe(true);
    });

    it("should classify restart-required keys correctly", () => {
      writeFileSync(testEnvPath, "PORT=4000\n");
      watcher = new ConfigWatcher(testEnvPath);
      const oldConfig = watcher.getConfig();

      writeFileSync(testEnvPath, "PORT=5000\n");
      const newConfig = new ConfigWatcher(testEnvPath).getConfig();

      const changes = (watcher as any).detectChanges(oldConfig, newConfig);

      expect(changes[0].hotReloadable).toBe(false);
    });

    it("should not emit events for unchanged config", () => {
      writeFileSync(testEnvPath, "SDK_MODEL=sonnet\n");
      watcher = new ConfigWatcher(testEnvPath);
      const config = watcher.getConfig();

      const changes = (watcher as any).detectChanges(config, config);

      expect(changes).toHaveLength(0);
    });
  });

  describe("file watching", () => {
    it("should start and stop watching", () => {
      expect(watcher.isWatching()).toBe(false);

      watcher.start();
      expect(watcher.isWatching()).toBe(true);

      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    it("should not start twice", () => {
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      watcher.start();
      watcher.start();

      expect(consoleWarn).toHaveBeenCalledWith("[config-watcher] Already running");
      consoleWarn.mockRestore();
    });

    it("should handle nonexistent file gracefully", () => {
      const nonexistentPath = path.join(tmpdir(), "nonexistent-file.env");
      const testWatcher = new ConfigWatcher(nonexistentPath);

      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      testWatcher.start();

      expect(consoleWarn).toHaveBeenCalled();
      expect(testWatcher.isWatching()).toBe(false);

      consoleWarn.mockRestore();
    });

    it("should emit config:changed events on file change", (done) => {
      watcher.start();

      const changes: ConfigChange[] = [];
      watcher.on("config:changed", (change: ConfigChange) => {
        changes.push(change);

        // Wait for debounce and check results
        setTimeout(() => {
          expect(changes.length).toBeGreaterThan(0);
          expect(changes[0].key).toBe("SDK_MODEL");
          expect(changes[0].newValue).toBe("opus");
          expect(changes[0].hotReloadable).toBe(true);
          done();
        }, 100);
      });

      // Modify the file
      setTimeout(() => {
        writeFileSync(testEnvPath, "SDK_MODEL=opus\nPORT=4000\n");
      }, 100);
    }, 10000);

    it("should debounce rapid changes", (done) => {
      watcher.start();

      let eventCount = 0;
      watcher.on("config:changed", () => {
        eventCount++;
      });

      // Make rapid changes
      writeFileSync(testEnvPath, "SDK_MODEL=opus\n");
      setTimeout(() => writeFileSync(testEnvPath, "SDK_MODEL=haiku\n"), 100);
      setTimeout(() => writeFileSync(testEnvPath, "SDK_MODEL=sonnet\n"), 200);

      // Check after debounce period (500ms) plus safety margin
      setTimeout(() => {
        // Should have processed only the last change
        expect(eventCount).toBeLessThanOrEqual(2);
        done();
      }, 1200);
    }, 10000);
  });

  describe("constants", () => {
    it("should define hot-reloadable keys", () => {
      expect(HOT_RELOADABLE_KEYS).toContain("SDK_MODEL");
      expect(HOT_RELOADABLE_KEYS).toContain("MAX_CONVERSATION_HISTORY");
      expect(HOT_RELOADABLE_KEYS).toContain("MAX_ACTIVITY_EVENTS");
      expect(HOT_RELOADABLE_KEYS).toContain("CCPLUS_BYPASS_PERMISSIONS");
    });

    it("should define restart-required keys", () => {
      expect(RESTART_REQUIRED_KEYS).toContain("PORT");
      expect(RESTART_REQUIRED_KEYS).toContain("HOST");
      expect(RESTART_REQUIRED_KEYS).toContain("SECRET_KEY");
      expect(RESTART_REQUIRED_KEYS).toContain("WORKSPACE_PATH");
      expect(RESTART_REQUIRED_KEYS).toContain("CCPLUS_AUTH");
      expect(RESTART_REQUIRED_KEYS).toContain("DATABASE_PATH");
    });

    it("should not overlap hot-reloadable and restart-required keys", () => {
      const hotSet = new Set(HOT_RELOADABLE_KEYS);
      const restartSet = new Set(RESTART_REQUIRED_KEYS);

      for (const key of HOT_RELOADABLE_KEYS) {
        expect(restartSet.has(key)).toBe(false);
      }

      for (const key of RESTART_REQUIRED_KEYS) {
        expect(hotSet.has(key)).toBe(false);
      }
    });
  });

  describe("getConfig", () => {
    it("should return a copy of current config", () => {
      const config1 = watcher.getConfig();
      const config2 = watcher.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });

    it("should not allow mutation of internal state", () => {
      const config = watcher.getConfig();
      config.SDK_MODEL = "mutated";

      const freshConfig = watcher.getConfig();
      expect(freshConfig.SDK_MODEL).toBe("sonnet"); // Original value
    });
  });

  describe("multiple changes", () => {
    it("should emit multiple events for multiple changes", (done) => {
      watcher.start();

      const changes: ConfigChange[] = [];
      watcher.on("config:changed", (change: ConfigChange) => {
        changes.push(change);
      });

      setTimeout(() => {
        writeFileSync(testEnvPath, "SDK_MODEL=opus\nPORT=5000\nNEW_KEY=value\n");
      }, 100);

      setTimeout(() => {
        expect(changes.length).toBe(3);
        expect(changes.map(c => c.key)).toContain("SDK_MODEL");
        expect(changes.map(c => c.key)).toContain("PORT");
        expect(changes.map(c => c.key)).toContain("NEW_KEY");
        done();
      }, 1000);
    }, 10000);
  });
});
