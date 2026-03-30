import { config as dotenvConfig } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { log } from "./logger.js";

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

export const MAX_CONVERSATION_HISTORY = 50;
export const MAX_ACTIVITY_EVENTS = 200;

// Export getters for hot-reloadable values
export function getSDKModel(): string {
  return settingsData.models?.sdk_model ?? DEFAULT_SETTINGS.models!.sdk_model!;
}

// Server PID path (for process management)
export const SERVER_PID_PATH = path.join(DATA_DIR, "node_server.pid");

// Memory system configuration
export const MEMORY_ENABLED = process.env.CCPLUS_MEMORY_ENABLED !== 'false';
export const MEMORY_DISTILL_ENABLED = process.env.CCPLUS_MEMORY_DISTILL !== 'false';
export const MEMORY_MAX_INJECT_TOKENS = 4096;
export const MEMORY_MAX_RESULTS = 5;
export const MEMORY_DISTILL_MIN_MESSAGES = 3;
export const MEMORY_SEARCH_TIMEOUT_MS = 5000;
export const MEMORY_INIT_TIMEOUT_MS = 30000;
export const MEMORY_HOOK_TIMEOUT_MS = 2000;
export const MEMORY_DISTILL_DEBOUNCE_MS = 60000;

// Workflow state machine configuration
export const WORKFLOW_ENABLED = process.env.CCPLUS_WORKFLOW_ENABLED === 'true';

// Worktree configuration
export const WORKTREE_ENABLED = process.env.CCPLUS_WORKTREES !== 'false';

// Captain configuration
export const CAPTAIN_AUTO_START = process.env.CCPLUS_CAPTAIN_AUTO_START !== 'false';
export const CAPTAIN_MODEL = process.env.CCPLUS_CAPTAIN_MODEL ?? 'claude-opus-4-6';
export const CAPTAIN_MAX_TURNS = parseInt(process.env.CCPLUS_CAPTAIN_MAX_TURNS ?? '1000', 10);
export const CAPTAIN_WORKSPACE = process.env.CCPLUS_CAPTAIN_WORKSPACE ?? WORKSPACE_PATH;
export const CAPTAIN_STATE_PATH = path.join(DATA_DIR, 'captain_state.json');
export const TELEGRAM_STATE_PATH = path.join(DATA_DIR, 'telegram_state.json');
export const DEPLOY_STATE_PATH = path.join(DATA_DIR, 'deploy_pending.json');
export const CAPTAIN_RESUME_ON_STARTUP = process.env.CCPLUS_CAPTAIN_RESUME_ON_STARTUP !== 'false';
export const CAPTAIN_CONTEXT_WINDOW = 1_000_000;

// Telegram bridge
export const TELEGRAM_BOT_TOKEN = process.env.CCPLUS_TELEGRAM_BOT_TOKEN ?? '';
export const TELEGRAM_ALLOWLIST: readonly string[] = (process.env.CCPLUS_TELEGRAM_ALLOWLIST ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Discord bridge
const DISCORD_BOT_TOKEN = process.env.CCPLUS_DISCORD_BOT_TOKEN ?? '';

// =========================================================================
// Settings Persistence Layer
// =========================================================================

const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

// Settings schema matching API structure
interface Settings {
  models?: {
    sdk_model?: string;
    captain_model?: string;
  };
  sessions?: {
    workspace_path?: string;
    bypass_permissions?: boolean;
  };
  memory?: {
    enabled?: boolean;
    distillation_enabled?: boolean;
    max_inject_tokens?: number;
    max_search_results?: number;
    search_timeout_ms?: number;
    distill_debounce_ms?: number;
    distill_min_messages?: number;
  };
  workflow?: {
    enforcement_enabled?: boolean;
    worktrees_enabled?: boolean;
  };
  captain?: {
    auto_start?: boolean;
    resume_on_startup?: boolean;
    workspace_path?: string;
    allow_edits?: boolean;
    allow_bash?: boolean;
  };
  integrations?: {
    telegram?: {
      bot_token?: string;
      allowed_users?: string[];
      typing_interval_ms?: number;
    };
    discord?: {
      bot_token?: string;
      allowed_users?: string[];
    };
  };
}

// Deep partial type for settings updates
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Default settings (matches .env defaults)
const DEFAULT_SETTINGS: Settings = {
  models: {
    sdk_model: "claude-sonnet-4-6",
    captain_model: "claude-opus-4-6",
  },
  sessions: {
    workspace_path: WORKSPACE_PATH,
    bypass_permissions: true,
  },
  memory: {
    enabled: true,
    distillation_enabled: true,
    max_inject_tokens: 4096,
    max_search_results: 5,
    search_timeout_ms: 5000,
    distill_debounce_ms: 60000,
    distill_min_messages: 3,
  },
  workflow: {
    enforcement_enabled: false,
    worktrees_enabled: true,
  },
  captain: {
    auto_start: true,
    resume_on_startup: true,
    workspace_path: CAPTAIN_WORKSPACE,
    allow_edits: false,
    allow_bash: true,
  },
  integrations: {
    telegram: {
      bot_token: '',
      allowed_users: [...TELEGRAM_ALLOWLIST],
      typing_interval_ms: 4000,
    },
    discord: {
      bot_token: '',
      allowed_users: (process.env.CCPLUS_DISCORD_ALLOWLIST ?? '')
        .split(',').map(s => s.trim()).filter(Boolean),
    },
  },
};

// In-memory settings state
let settingsData: Settings = structuredClone(DEFAULT_SETTINGS);

/**
 * Deep merge helper - immutably merges source into target
 */
function deepMerge<T extends object>(target: T, source: DeepPartial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (sourceValue !== undefined) {
        if (
          typeof sourceValue === 'object' &&
          sourceValue !== null &&
          !Array.isArray(sourceValue) &&
          typeof targetValue === 'object' &&
          targetValue !== null &&
          !Array.isArray(targetValue)
        ) {
          // Recursively merge objects
          result[key] = deepMerge(targetValue as object, sourceValue as DeepPartial<object>) as T[Extract<keyof T, string>];
        } else {
          // Replace primitives, arrays, or null values
          result[key] = sourceValue as T[Extract<keyof T, string>];
        }
      }
    }
  }

  return result;
}

/**
 * Load settings from settings.json (if exists) and merge onto defaults
 * Called automatically at module initialization
 */
export function loadSettings(): Settings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const fileContent = readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(fileContent) as DeepPartial<Settings>;
      settingsData = deepMerge(DEFAULT_SETTINGS, parsed);

      return settingsData;
    }
  } catch (error) {
    log.warn("Failed to load settings.json, using defaults", { error: String(error) });
  }

  settingsData = structuredClone(DEFAULT_SETTINGS);
  return settingsData;
}

/**
 * Save partial settings update to settings.json and update in-memory state
 * Returns whether restart is required for changes to take effect
 */
export function saveSettings(partial: DeepPartial<Settings>): { restart_required: boolean } {
  // Merge partial update into current settings
  settingsData = deepMerge(settingsData, partial);

  // Write to file
  try {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settingsData, null, 2), "utf-8");
  } catch (error) {
    throw new Error(`Failed to write settings.json: ${String(error)}`);
  }

  // Check if restart is required
  const restartRequired = isRestartRequired(partial);

  return { restart_required: restartRequired };
}

/**
 * Check if any restart-required keys were modified
 */
export function isRestartRequired(partial: DeepPartial<Settings>): boolean {
  // Restart-required paths:
  // - captain.auto_start, captain.resume_on_startup, captain.workspace_path
  // - integrations.telegram.* (all), integrations.discord.* (all)

  if (partial.captain) {
    if (
      partial.captain.auto_start !== undefined ||
      partial.captain.resume_on_startup !== undefined ||
      partial.captain.workspace_path !== undefined
    ) {
      return true;
    }
  }

  if (partial.integrations?.telegram !== undefined || partial.integrations?.discord !== undefined) {
    return true;
  }

  return false;
}

/**
 * Get raw settings (unredacted, for routes/config.ts)
 */
export function getSettingsRaw(): Settings {
  return structuredClone(settingsData);
}

/**
 * Get resolved config with secrets redacted (for API responses)
 */
export function getResolvedConfig(): object {
  return {
    models: {
      sdk_model: settingsData.models?.sdk_model ?? DEFAULT_SETTINGS.models!.sdk_model,
      captain_model: settingsData.models?.captain_model ?? DEFAULT_SETTINGS.models!.captain_model,
    },
    sessions: {
      workspace_path: settingsData.sessions?.workspace_path ?? DEFAULT_SETTINGS.sessions!.workspace_path,
      bypass_permissions: settingsData.sessions?.bypass_permissions ?? DEFAULT_SETTINGS.sessions!.bypass_permissions,
    },
    memory: {
      enabled: settingsData.memory?.enabled ?? DEFAULT_SETTINGS.memory!.enabled,
      distillation_enabled: settingsData.memory?.distillation_enabled ?? DEFAULT_SETTINGS.memory!.distillation_enabled,
      max_inject_tokens: settingsData.memory?.max_inject_tokens ?? DEFAULT_SETTINGS.memory!.max_inject_tokens,
      max_search_results: settingsData.memory?.max_search_results ?? DEFAULT_SETTINGS.memory!.max_search_results,
      search_timeout_ms: settingsData.memory?.search_timeout_ms ?? DEFAULT_SETTINGS.memory!.search_timeout_ms,
      distill_debounce_ms: settingsData.memory?.distill_debounce_ms ?? DEFAULT_SETTINGS.memory!.distill_debounce_ms,
      distill_min_messages: settingsData.memory?.distill_min_messages ?? DEFAULT_SETTINGS.memory!.distill_min_messages,
    },
    workflow: {
      enforcement_enabled: settingsData.workflow?.enforcement_enabled ?? DEFAULT_SETTINGS.workflow!.enforcement_enabled,
      worktrees_enabled: settingsData.workflow?.worktrees_enabled ?? DEFAULT_SETTINGS.workflow!.worktrees_enabled,
    },
    captain: {
      auto_start: settingsData.captain?.auto_start ?? DEFAULT_SETTINGS.captain!.auto_start,
      resume_on_startup: settingsData.captain?.resume_on_startup ?? DEFAULT_SETTINGS.captain!.resume_on_startup,
      workspace_path: settingsData.captain?.workspace_path ?? DEFAULT_SETTINGS.captain!.workspace_path,
      allow_edits: settingsData.captain?.allow_edits ?? DEFAULT_SETTINGS.captain!.allow_edits,
      allow_bash: settingsData.captain?.allow_bash ?? DEFAULT_SETTINGS.captain!.allow_bash,
    },
    integrations: {
      telegram: {
        bot_token_set: Boolean(settingsData.integrations?.telegram?.bot_token ?? TELEGRAM_BOT_TOKEN),
        allowed_users: settingsData.integrations?.telegram?.allowed_users ?? DEFAULT_SETTINGS.integrations!.telegram!.allowed_users,
        typing_interval_ms: settingsData.integrations?.telegram?.typing_interval_ms ?? DEFAULT_SETTINGS.integrations!.telegram!.typing_interval_ms,
      },
      discord: {
        bot_token_set: Boolean(settingsData.integrations?.discord?.bot_token ?? DISCORD_BOT_TOKEN),
        allowed_users: settingsData.integrations?.discord?.allowed_users ?? DEFAULT_SETTINGS.integrations!.discord!.allowed_users,
      },
    },
  };
}

// =========================================================================
// Settings Getters (for internal use)
// =========================================================================

export function getCaptainModel(): string {
  return settingsData.models?.captain_model ?? DEFAULT_SETTINGS.models!.captain_model!;
}

export function getMemoryEnabled(): boolean {
  return settingsData.memory?.enabled ?? DEFAULT_SETTINGS.memory!.enabled!;
}

export function getDistillationEnabled(): boolean {
  return settingsData.memory?.distillation_enabled ?? DEFAULT_SETTINGS.memory!.distillation_enabled!;
}

export function getMemoryMaxInjectTokens(): number {
  return settingsData.memory?.max_inject_tokens ?? DEFAULT_SETTINGS.memory!.max_inject_tokens!;
}

export function getMemoryMaxResults(): number {
  return settingsData.memory?.max_search_results ?? DEFAULT_SETTINGS.memory!.max_search_results!;
}

export function getMemorySearchTimeoutMs(): number {
  return settingsData.memory?.search_timeout_ms ?? DEFAULT_SETTINGS.memory!.search_timeout_ms!;
}

export function getMemoryDistillDebounceMs(): number {
  return settingsData.memory?.distill_debounce_ms ?? DEFAULT_SETTINGS.memory!.distill_debounce_ms!;
}

export function getMemoryDistillMinMessages(): number {
  return settingsData.memory?.distill_min_messages ?? DEFAULT_SETTINGS.memory!.distill_min_messages!;
}

export function getWorkflowEnabled(): boolean {
  return settingsData.workflow?.enforcement_enabled ?? DEFAULT_SETTINGS.workflow!.enforcement_enabled!;
}

export function getWorktreeEnabled(): boolean {
  return settingsData.workflow?.worktrees_enabled ?? DEFAULT_SETTINGS.workflow!.worktrees_enabled!;
}

export function getCaptainAutoStart(): boolean {
  return settingsData.captain?.auto_start ?? DEFAULT_SETTINGS.captain!.auto_start!;
}

export function getCaptainResumeOnStartup(): boolean {
  return settingsData.captain?.resume_on_startup ?? DEFAULT_SETTINGS.captain!.resume_on_startup!;
}

export function getCaptainWorkspace(): string {
  return settingsData.captain?.workspace_path ?? DEFAULT_SETTINGS.captain!.workspace_path!;
}

export function getCaptainAllowEdits(): boolean {
  return settingsData.captain?.allow_edits ?? DEFAULT_SETTINGS.captain!.allow_edits!;
}

export function getCaptainAllowBash(): boolean {
  return settingsData.captain?.allow_bash ?? DEFAULT_SETTINGS.captain!.allow_bash!;
}

// Load settings on module initialization
loadSettings();
