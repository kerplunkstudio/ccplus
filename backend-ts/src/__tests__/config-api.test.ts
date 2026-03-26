import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import * as config from "../config.js";

// Import server to start it as a side effect and enable coverage tracking
import "../server.js";

const SETTINGS_PATH = path.join(config.DATA_DIR, "settings.json");

describe("Settings Persistence", () => {
  // Clean up settings.json before each test
  beforeEach(() => {
    if (existsSync(SETTINGS_PATH)) {
      unlinkSync(SETTINGS_PATH);
    }
  });

  // Clean up after tests
  afterEach(() => {
    if (existsSync(SETTINGS_PATH)) {
      unlinkSync(SETTINGS_PATH);
    }
  });

  describe("loadSettings()", () => {
    it("returns defaults when settings.json doesn't exist", () => {
      const settings = config.loadSettings();

      expect(settings.models?.sdk_model).toBe("claude-sonnet-4-6");
      expect(settings.models?.captain_model).toBe("claude-opus-4-6");
      expect(settings.memory?.enabled).toBe(true);
      expect(settings.workflow?.worktrees_enabled).toBe(true);
    });

    it("merges partial settings file onto defaults", () => {
      // Write partial settings
      const partialSettings = {
        models: {
          sdk_model: "claude-opus-4-6",
        },
        memory: {
          enabled: false,
        },
      };
      writeFileSync(SETTINGS_PATH, JSON.stringify(partialSettings, null, 2), "utf-8");

      const settings = config.loadSettings();

      // Changed values
      expect(settings.models?.sdk_model).toBe("claude-opus-4-6");
      expect(settings.memory?.enabled).toBe(false);

      // Unchanged values (should still be defaults)
      expect(settings.models?.captain_model).toBe("claude-opus-4-6");
      expect(settings.workflow?.worktrees_enabled).toBe(true);
    });

    it("handles malformed JSON gracefully", () => {
      // Write invalid JSON
      writeFileSync(SETTINGS_PATH, "{ invalid json }", "utf-8");

      // Should not throw, should use defaults
      const settings = config.loadSettings();
      expect(settings.models?.sdk_model).toBe("claude-sonnet-4-6");
    });
  });

  describe("saveSettings()", () => {
    it("writes to file and updates in-memory state", () => {
      const partial = {
        models: {
          sdk_model: "claude-haiku-4-5-20251001",
        },
      };

      config.saveSettings(partial);

      // Check file was written
      expect(existsSync(SETTINGS_PATH)).toBe(true);

      // Check in-memory state by getting resolved config
      const resolved = config.getResolvedConfig() as any;
      expect(resolved.models.sdk_model).toBe("claude-haiku-4-5-20251001");
    });

    it("performs deep merge (partial update doesn't clobber siblings)", () => {
      // Save initial settings with multiple model fields
      config.saveSettings({
        models: {
          sdk_model: "claude-opus-4-6",
          captain_model: "claude-sonnet-4-6",
        },
      });

      // Update only sdk_model
      config.saveSettings({
        models: {
          sdk_model: "claude-haiku-4-5-20251001",
        },
      });

      const resolved = config.getResolvedConfig() as any;
      expect(resolved.models.sdk_model).toBe("claude-haiku-4-5-20251001");
      expect(resolved.models.captain_model).toBe("claude-sonnet-4-6"); // Should NOT be reset to default
    });

    it("returns restart_required: true for captain.auto_start change", () => {
      const result = config.saveSettings({
        captain: {
          auto_start: false,
        },
      });

      expect(result.restart_required).toBe(true);
    });

    it("returns restart_required: true for captain.resume_on_startup change", () => {
      const result = config.saveSettings({
        captain: {
          resume_on_startup: false,
        },
      });

      expect(result.restart_required).toBe(true);
    });

    it("returns restart_required: true for captain.workspace_path change", () => {
      const result = config.saveSettings({
        captain: {
          workspace_path: "/tmp/test",
        },
      });

      expect(result.restart_required).toBe(true);
    });

    it("returns restart_required: true for telegram settings change", () => {
      const result = config.saveSettings({
        integrations: {
          telegram: {
            bot_token: "test-token",
          },
        },
      });

      expect(result.restart_required).toBe(true);
    });

    it("returns restart_required: true for discord settings change", () => {
      const result = config.saveSettings({
        integrations: {
          discord: {
            bot_token: "test-token",
          },
        },
      });

      expect(result.restart_required).toBe(true);
    });

    it("returns restart_required: false for hot-reloadable-only changes", () => {
      const result = config.saveSettings({
        models: {
          sdk_model: "claude-opus-4-6",
        },
        memory: {
          enabled: false,
        },
      });

      expect(result.restart_required).toBe(false);
    });

    it("returns restart_required: false for captain.allow_edits change", () => {
      const result = config.saveSettings({
        captain: {
          allow_edits: true,
        },
      });

      expect(result.restart_required).toBe(false);
    });
  });

  describe("getResolvedConfig()", () => {
    it("redacts tokens to bot_token_set boolean", () => {
      config.saveSettings({
        integrations: {
          telegram: {
            bot_token: "secret-token-123",
          },
          discord: {
            bot_token: "secret-token-456",
          },
        },
      });

      const resolved = config.getResolvedConfig() as any;

      expect(resolved.integrations.telegram.bot_token_set).toBe(true);
      expect(resolved.integrations.discord.bot_token_set).toBe(true);
      expect(resolved.integrations.telegram.bot_token).toBeUndefined();
      expect(resolved.integrations.discord.bot_token).toBeUndefined();
    });

    it("shows bot_token_set: false when token is empty", () => {
      config.saveSettings({
        integrations: {
          telegram: {
            bot_token: "",
          },
        },
      });

      const resolved = config.getResolvedConfig() as any;
      expect(resolved.integrations.telegram.bot_token_set).toBe(false);
    });
  });

  describe("Settings Getters", () => {
    it("getCaptainModel returns correct value", () => {
      config.saveSettings({
        models: {
          captain_model: "claude-sonnet-4-6",
        },
      });

      expect(config.getCaptainModel()).toBe("claude-sonnet-4-6");
    });

    it("getMemoryEnabled returns correct value", () => {
      config.saveSettings({
        memory: {
          enabled: false,
        },
      });

      expect(config.getMemoryEnabled()).toBe(false);
    });

    it("getDistillationEnabled returns correct value", () => {
      config.saveSettings({
        memory: {
          distillation_enabled: false,
        },
      });

      expect(config.getDistillationEnabled()).toBe(false);
    });

    it("getWorkflowEnabled returns correct value", () => {
      config.saveSettings({
        workflow: {
          enforcement_enabled: true,
        },
      });

      expect(config.getWorkflowEnabled()).toBe(true);
    });

    it("getWorktreeEnabled returns correct value", () => {
      config.saveSettings({
        workflow: {
          worktrees_enabled: false,
        },
      });

      expect(config.getWorktreeEnabled()).toBe(false);
    });

    it("getCaptainAutoStart returns correct value", () => {
      config.saveSettings({
        captain: {
          auto_start: false,
        },
      });

      expect(config.getCaptainAutoStart()).toBe(false);
    });

    it("getCaptainAllowEdits returns correct value", () => {
      config.saveSettings({
        captain: {
          allow_edits: true,
        },
      });

      expect(config.getCaptainAllowEdits()).toBe(true);
    });
  });
});

describe("Config API Routes", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  // Clean up settings.json before each test
  beforeEach(() => {
    if (existsSync(SETTINGS_PATH)) {
      unlinkSync(SETTINGS_PATH);
    }
    // Reset to defaults
    config.loadSettings();
  });

  afterEach(() => {
    if (existsSync(SETTINGS_PATH)) {
      unlinkSync(SETTINGS_PATH);
    }
  });

  describe("GET /api/config", () => {
    it("returns 200 with expected shape", async () => {
      const response = await fetch(`${serverUrl}/api/config`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("models");
      expect(data).toHaveProperty("sessions");
      expect(data).toHaveProperty("memory");
      expect(data).toHaveProperty("workflow");
      expect(data).toHaveProperty("captain");
      expect(data).toHaveProperty("integrations");

      expect(data.models).toHaveProperty("defaultModel");
      expect(data.models).toHaveProperty("captainModel");

      expect(data.integrations.telegram).toHaveProperty("botToken");
      expect(data.integrations.discord).toHaveProperty("botToken");
      expect(typeof data.integrations.telegram.botToken).toBe("string");
      expect(typeof data.integrations.discord.botToken).toBe("string");
    });
  });

  describe("POST /api/config", () => {
    it("returns 200 with valid partial body", async () => {
      const response = await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "models.defaultModel",
          value: "claude-opus-4-6",
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(typeof data.needsRestart).toBe("boolean");
    });

    it("returns 400 with invalid body", async () => {
      // With .partial(), unknown keys are still rejected
      // But we also need to test invalid types
      const response = await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: {
            sdk_model: 123, // Should be string, not number
          },
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty("error");
    });

    it("returns 400 with invalid type for setting", async () => {
      const response = await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memory: {
            enabled: "not-a-boolean", // Should be boolean
          },
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty("error");
    });

    it("returns restart_required: true for captain.auto_start change", async () => {
      const response = await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "captain.autoStart",
          value: false,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.needsRestart).toBe(true);
    });

    it("returns restart_required: false for hot-reloadable changes", async () => {
      const response = await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "models.defaultModel",
          value: "claude-haiku-4-5-20251001",
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.needsRestart).toBe(false);
    });

    it("persists settings across multiple updates", async () => {
      // First update
      await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "models.defaultModel",
          value: "claude-opus-4-6",
        }),
      });

      // Second update (different field)
      await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "models.captainModel",
          value: "claude-sonnet-4-6",
        }),
      });

      // Third update (change first field again)
      await fetch(`${serverUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "models.defaultModel",
          value: "claude-haiku-4-5-20251001",
        }),
      });

      // Verify both are present
      const response = await fetch(`${serverUrl}/api/config`);
      const data = await response.json();

      expect(data.models.defaultModel).toBe("claude-haiku-4-5-20251001");
      expect(data.models.captainModel).toBe("claude-sonnet-4-6");
    });
  });
});
