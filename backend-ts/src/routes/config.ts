import type { Express, Request, Response } from "express";
import * as db from "../db/index.js";

const DEFAULT_CONFIG = {
  models: {
    defaultModel: 'claude-sonnet-4.5-20250929',
    captainModel: 'claude-sonnet-4.5-20250929',
  },
  sessions: {
    workspacePath: '~/Workspace',
    bypassPermissions: false,
  },
  memory: {
    enabled: true,
    distillationEnabled: true,
    maxInjectTokens: 4000,
    maxSearchResults: 10,
    searchTimeout: 5000,
    distillDebounce: 30000,
    minMessages: 3,
  },
  workflow: {
    workflowEnforcement: true,
    worktreesEnabled: true,
    codeReviewGate: true,
    testCoverageGate: false,
  },
  captain: {
    autoStart: false,
    resumeOnStartup: false,
    captainWorkspace: '~/captain-workspace',
    allowEdits: true,
    allowBash: true,
  },
  integrations: {
    telegram: {
      botToken: '',
      allowedUsers: [],
      typingInterval: 3000,
    },
    discord: {
      botToken: '',
      allowedUsers: [],
    },
  },
};

// Restart-required settings (keys that require app restart)
const RESTART_REQUIRED_KEYS = new Set([
  'captain.autoStart',
  'captain.resumeOnStartup',
  'captain.captainWorkspace',
  'integrations.telegram.botToken',
  'integrations.telegram.allowedUsers',
  'integrations.telegram.typingInterval',
  'integrations.discord.botToken',
  'integrations.discord.allowedUsers',
]);

/**
 * Deep merge two objects (DB values override defaults)
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];
      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
      } else {
        result[key] = sourceValue;
      }
    }
  }
  return result;
}

/**
 * Load config from database and merge with defaults
 */
function loadConfigFromDb(): typeof DEFAULT_CONFIG {
  const dbConfig = db.getAllConfig();
  return deepMerge(DEFAULT_CONFIG, dbConfig) as typeof DEFAULT_CONFIG;
}

// In-memory config cache for fast reads (backed by database)
// Initialize from database on module load
let currentConfig = loadConfigFromDb();

export function createConfigRoutes(app: Express): void {
  app.get("/api/config", (_req: Request, res: Response) => {
    res.json(currentConfig);
  });

  app.post("/api/config", (req: Request, res: Response) => {
    const { key, value } = req.body;

    if (!key || value === undefined) {
      res.status(400).json({ error: "Missing 'key' or 'value' in request body" });
      return;
    }

    // Validate key doesn't contain prototype pollution vectors
    const keys = key.split('.');
    for (const k of keys) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        res.status(400).json({ error: "Invalid key: contains forbidden property name" });
        return;
      }
    }

    // Deep copy currentConfig to avoid mutation
    const updatedConfig = JSON.parse(JSON.stringify(currentConfig)) as typeof DEFAULT_CONFIG;

    // Update config using dot-notation key with proper typing
    let current: Record<string, unknown> = updatedConfig as unknown as Record<string, unknown>;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!Object.prototype.hasOwnProperty.call(current, keys[i])) {
        current[keys[i]] = {};
      }
      current = current[keys[i]] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;

    // Persist to database
    db.setConfigValue(key, value);

    // Assign the updated config (in-memory cache)
    currentConfig = updatedConfig;

    // Check if restart is required
    const needsRestart = RESTART_REQUIRED_KEYS.has(key);

    res.json({
      status: 'ok',
      needsRestart,
    });
  });

  app.post("/api/config/reset", (_req: Request, res: Response) => {
    // Clear database
    db.resetConfig();
    // Reset in-memory cache
    currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    res.json({ status: 'ok' });
  });
}
