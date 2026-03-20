import { config as dotenvConfig } from "dotenv";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";

// Load .env from project root (one level up from backend-ts/)
dotenvConfig({ path: path.resolve(import.meta.dirname, "../../.env") });

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const LOG_DIR = path.join(PROJECT_ROOT, "logs");
export const WORKFLOWS_DIR = path.join(DATA_DIR, "workflows");
export const STATIC_DIR = path.join(PROJECT_ROOT, "static", "chat");

// Ensure dirs exist
for (const dir of [DATA_DIR, LOG_DIR, WORKFLOWS_DIR]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Version
const VERSION_FILE = path.join(PROJECT_ROOT, "VERSION");
let version = "dev";
try {
  version = readFileSync(VERSION_FILE, "utf-8").trim();
} catch {
  // VERSION file doesn't exist in dev
}
export const VERSION = version;

export const CCPLUS_CHANNEL = process.env.CCPLUS_CHANNEL ?? "stable";

// Environment
export const WORKSPACE_PATH = process.env.WORKSPACE_PATH ?? path.join(homedir(), "Workspace");
export const SDK_MODEL = process.env.SDK_MODEL ?? "claude-sonnet-4-6";
export const HOST = process.env.HOST ?? "127.0.0.1";
export const PORT = parseInt(process.env.PORT ?? "4000", 10);
export const DATABASE_PATH = process.env.DATABASE_PATH ?? path.join(DATA_DIR, "ccplus.db");

// Hot-reloadable config values (can be updated dynamically)
let runtimeConfig = {
  SDK_MODEL: process.env.SDK_MODEL ?? "claude-sonnet-4-6",
  MAX_CONVERSATION_HISTORY: 50,
  MAX_ACTIVITY_EVENTS: 200,
  BYPASS_PERMISSIONS: true,
};

export const MAX_CONVERSATION_HISTORY_DEFAULT = 50;
export const MAX_ACTIVITY_EVENTS_DEFAULT = 200;

// Export getters for hot-reloadable values
export function getSDKModel(): string {
  return runtimeConfig.SDK_MODEL;
}

export function getMaxConversationHistory(): number {
  return runtimeConfig.MAX_CONVERSATION_HISTORY;
}

export function getMaxActivityEvents(): number {
  return runtimeConfig.MAX_ACTIVITY_EVENTS;
}

export function getBypassPermissions(): boolean {
  return runtimeConfig.BYPASS_PERMISSIONS;
}

// Legacy exports for backward compatibility (deprecated, use getters)
export const MAX_CONVERSATION_HISTORY = MAX_CONVERSATION_HISTORY_DEFAULT;
export const MAX_ACTIVITY_EVENTS = MAX_ACTIVITY_EVENTS_DEFAULT;

// Server PID path (for process management)
export const SERVER_PID_PATH = path.join(DATA_DIR, "node_server.pid");

// Permission bypass (always enabled)
export const BYPASS_PERMISSIONS = true;

// Memory system configuration
export const MEMORY_ENABLED = process.env.CCPLUS_MEMORY_ENABLED !== 'false';
export const MEMORY_DISTILL_ENABLED = process.env.CCPLUS_MEMORY_DISTILL !== 'false';
export const MEMORY_MAX_INJECT_TOKENS = 4096;
export const MEMORY_MAX_RESULTS = 5;
export const MEMORY_DISTILL_MODEL = 'claude-haiku-4-5-20251001';
export const MEMORY_DISTILL_MIN_MESSAGES = 3;
export const MEMORY_SEARCH_TIMEOUT_MS = 5000;
export const MEMORY_INIT_TIMEOUT_MS = 30000;
export const MEMORY_HOOK_TIMEOUT_MS = 2000;
export const MEMORY_DISTILL_DEBOUNCE_MS = 60000;

// Workflow state machine configuration
export const WORKFLOW_ENABLED = process.env.CCPLUS_WORKFLOW_ENABLED === 'true';

// Worktree configuration
export const WORKTREE_ENABLED = process.env.CCPLUS_WORKTREES !== 'false';

/**
 * Reload hot-reloadable config values from environment
 * Called by ConfigWatcher when .env changes
 */
export function reloadConfig(key: string, value: string | undefined): void {
  switch (key) {
    case "SDK_MODEL":
      runtimeConfig.SDK_MODEL = value ?? "claude-sonnet-4-6";
      break;
    case "MAX_CONVERSATION_HISTORY":
      runtimeConfig.MAX_CONVERSATION_HISTORY = value ? parseInt(value, 10) : MAX_CONVERSATION_HISTORY_DEFAULT;
      break;
    case "MAX_ACTIVITY_EVENTS":
      runtimeConfig.MAX_ACTIVITY_EVENTS = value ? parseInt(value, 10) : MAX_ACTIVITY_EVENTS_DEFAULT;
      break;
    case "CCPLUS_BYPASS_PERMISSIONS":
      runtimeConfig.BYPASS_PERMISSIONS = value === 'true';
      break;
  }
}

/**
 * Get all runtime config values (for testing/debugging)
 */
export function getRuntimeConfig() {
  return { ...runtimeConfig };
}
