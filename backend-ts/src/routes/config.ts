import type { Express, Request, Response } from "express";
import { getSettingsRaw, saveSettings, loadSettings } from "../config.js";
import { unlinkSync, existsSync } from "fs";
import path from "path";
import { DATA_DIR } from "../config.js";

const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

// Key mapping: frontend camelCase -> backend snake_case
const KEY_MAPPING: Record<string, string> = {
  "models.defaultModel": "models.sdk_model",
  "models.captainModel": "models.captain_model",
  "sessions.workspacePath": "sessions.workspace_path",
  "sessions.bypassPermissions": "sessions.bypass_permissions",
  "memory.enabled": "memory.enabled",
  "memory.distillationEnabled": "memory.distillation_enabled",
  "memory.maxInjectTokens": "memory.max_inject_tokens",
  "memory.maxSearchResults": "memory.max_search_results",
  "memory.searchTimeout": "memory.search_timeout_ms",
  "memory.distillDebounce": "memory.distill_debounce_ms",
  "memory.minMessages": "memory.distill_min_messages",
  "workflow.workflowEnforcement": "workflow.enforcement_enabled",
  "workflow.worktreesEnabled": "workflow.worktrees_enabled",
  "captain.autoStart": "captain.auto_start",
  "captain.resumeOnStartup": "captain.resume_on_startup",
  "captain.captainWorkspace": "captain.workspace_path",
  "captain.allowEdits": "captain.allow_edits",
  "captain.allowBash": "captain.allow_bash",
  "integrations.telegram.botToken": "integrations.telegram.bot_token",
  "integrations.telegram.allowedUsers": "integrations.telegram.allowed_users",
  "integrations.telegram.typingInterval": "integrations.telegram.typing_interval_ms",
  "integrations.discord.botToken": "integrations.discord.bot_token",
  "integrations.discord.allowedUsers": "integrations.discord.allowed_users",
};


const KEY_TYPES: Record<string, 'string' | 'number' | 'boolean' | 'array'> = {
  'models.defaultModel': 'string',
  'models.captainModel': 'string',
  'sessions.workspacePath': 'string',
  'sessions.bypassPermissions': 'boolean',
  'memory.distillationEnabled': 'boolean',
  'memory.maxInjectTokens': 'number',
  'memory.maxSearchResults': 'number',
  'memory.searchTimeout': 'number',
  'memory.distillDebounce': 'number',
  'memory.minMessages': 'number',
  'workflow.workflowEnforcement': 'boolean',
  'workflow.worktreesEnabled': 'boolean',
  'captain.autoStart': 'boolean',
  'captain.resumeOnStartup': 'boolean',
  'captain.captainWorkspace': 'string',
  'captain.allowEdits': 'boolean',
  'captain.allowBash': 'boolean',
  'integrations.telegram.botToken': 'string',
  'integrations.telegram.allowedUsers': 'array',
  'integrations.telegram.typingInterval': 'number',
  'integrations.discord.botToken': 'string',
  'integrations.discord.allowedUsers': 'array',
};

// Reverse mapping: backend snake_case -> frontend camelCase
const REVERSE_KEY_MAPPING: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_MAPPING).map(([k, v]) => [v, k])
);

/**
 * Transform snake_case keys to camelCase for frontend
 */
function transformToFrontend(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = transformToFrontend(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  // Apply key mappings
  const transformed: Record<string, unknown> = {};

  function applyMapping(obj: Record<string, unknown>, prefix: string = ""): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const camelKey = REVERSE_KEY_MAPPING[fullKey];

      if (camelKey) {
        const parts = camelKey.split(".");
        let current: Record<string, unknown> = transformed;

        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) {
            current[parts[i]] = {};
          }
          current = current[parts[i]] as Record<string, unknown>;
        }

        current[parts[parts.length - 1]] = value;
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        applyMapping(value as Record<string, unknown>, fullKey);
      } else {
        // Keep unmapped keys as-is
        const parts = fullKey.split(".");
        let current: Record<string, unknown> = transformed;

        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) {
            current[parts[i]] = {};
          }
          current = current[parts[i]] as Record<string, unknown>;
        }

        current[parts[parts.length - 1]] = value;
      }
    }
  }

  applyMapping(result);
  return transformed;
}

/**
 * Redact bot token fields: replace actual token strings with boolean (whether set)
 */
function redactBotTokens(frontendSettings: Record<string, unknown>, rawSettings: Record<string, unknown>): Record<string, unknown> {
  const raw = rawSettings as { integrations?: { telegram?: { bot_token?: string }; discord?: { bot_token?: string } } };
  const result = { ...frontendSettings };

  if (result.integrations && typeof result.integrations === 'object') {
    const integrations = { ...(result.integrations as Record<string, unknown>) };
    if (integrations.telegram && typeof integrations.telegram === 'object') {
      integrations.telegram = {
        ...(integrations.telegram as Record<string, unknown>),
        botToken: !!raw.integrations?.telegram?.bot_token,
      };
    }
    if (integrations.discord && typeof integrations.discord === 'object') {
      integrations.discord = {
        ...(integrations.discord as Record<string, unknown>),
        botToken: !!raw.integrations?.discord?.bot_token,
      };
    }
    result.integrations = integrations;
  }

  return result;
}

/**
 * Parse dot-notation key into nested object path
 */
function parseNestedPath(key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  const result: Record<string, unknown> = {};
  let current: Record<string, unknown> = result;

  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
  return result;
}

export function createConfigRoutes(app: Express): void {
  app.get("/api/config", (_req: Request, res: Response) => {
    const rawSettings = getSettingsRaw();
    const frontendSettings = transformToFrontend(rawSettings as Record<string, unknown>);
    const redacted = redactBotTokens(frontendSettings, rawSettings as Record<string, unknown>);
    res.json(redacted);
  });

  app.post("/api/config", (req: Request, res: Response) => {
    const { key, value } = req.body;

    if (!key || value === undefined) {
      res.status(400).json({ error: "Missing 'key' or 'value' in request body" });
      return;
    }

    // Validate key doesn't contain prototype pollution vectors
    const keys = key.split(".");
    for (const k of keys) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") {
        res.status(400).json({ error: "Invalid key: contains forbidden property name" });
        return;
      }
    }

    // Map frontend camelCase key to backend snake_case key
    const backendKey = KEY_MAPPING[key];
    if (!backendKey) {
      res.status(400).json({ error: `Unknown config key: ${key}` });
      return;
    }

    // Validate value type
    const expectedType = KEY_TYPES[key];
    if (expectedType !== undefined) {
      const valid = expectedType === 'array' ? Array.isArray(value) : typeof value === expectedType;
      if (!valid) {
        res.status(400).json({ error: `Invalid type for ${key}: expected ${expectedType}` });
        return;
      }
    }

    // Parse backend key into nested object
    const partial = parseNestedPath(backendKey, value);

    try {
      // Save to settings.json
      const result = saveSettings(partial);

      res.json({
        status: "ok",
        needsRestart: result.restart_required,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/config/reset", (_req: Request, res: Response) => {
    try {
      // Delete settings.json
      if (existsSync(SETTINGS_PATH)) {
        unlinkSync(SETTINGS_PATH);
      }

      // Reload defaults
      loadSettings();

      res.json({ status: "ok" });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
