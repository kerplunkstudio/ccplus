import { EventEmitter } from "events";
import { watch, FSWatcher, readFileSync, existsSync } from "fs";
import path from "path";
import { PROJECT_ROOT } from "./config.js";

// Keys that can be hot-reloaded without restarting the server
export const HOT_RELOADABLE_KEYS = [
  "SDK_MODEL",
  "MAX_CONVERSATION_HISTORY",
  "MAX_ACTIVITY_EVENTS",
  "CCPLUS_BYPASS_PERMISSIONS",
] as const;

// Keys that require server restart to take effect
export const RESTART_REQUIRED_KEYS = [
  "PORT",
  "HOST",
  "SECRET_KEY",
  "WORKSPACE_PATH",
  "CCPLUS_AUTH",
  "DATABASE_PATH",
  "CCPLUS_CHANNEL",
  "CORS_ORIGINS",
] as const;

export type HotReloadableKey = typeof HOT_RELOADABLE_KEYS[number];
export type RestartRequiredKey = typeof RESTART_REQUIRED_KEYS[number];
export type ConfigKey = HotReloadableKey | RestartRequiredKey;

export interface ConfigChange {
  key: string;
  oldValue: string | undefined;
  newValue: string | undefined;
  hotReloadable: boolean;
}

export interface ConfigData {
  [key: string]: string | undefined;
}

/**
 * Watches .env file for changes and emits config:changed events.
 * Hot-reloadable keys update immediately, restart-required keys emit warnings.
 */
export class ConfigWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly envPath: string;
  private currentConfig: ConfigData = {};
  private isRunning = false;

  constructor(envPath?: string) {
    super();
    this.envPath = envPath ?? path.join(PROJECT_ROOT, ".env");
    this.currentConfig = this.readEnvFile();
  }

  /**
   * Read and parse .env file into key-value pairs
   */
  private readEnvFile(): ConfigData {
    if (!existsSync(this.envPath)) {
      return {};
    }

    const config: ConfigData = {};
    try {
      const content = readFileSync(this.envPath, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }

        // Parse KEY=VALUE format
        const equalsIndex = trimmed.indexOf("=");
        if (equalsIndex === -1) {
          continue;
        }

        const key = trimmed.slice(0, equalsIndex).trim();
        let value = trimmed.slice(equalsIndex + 1).trim();

        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        config[key] = value;
      }
    } catch (error) {
      console.error("[config-watcher] Error reading .env file:", error);
    }

    return config;
  }

  /**
   * Detect changes between old and new config
   */
  private detectChanges(oldConfig: ConfigData, newConfig: ConfigData): ConfigChange[] {
    const changes: ConfigChange[] = [];
    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

    for (const key of allKeys) {
      const oldValue = oldConfig[key];
      const newValue = newConfig[key];

      if (oldValue !== newValue) {
        const isHotReloadable = HOT_RELOADABLE_KEYS.includes(key as HotReloadableKey);
        changes.push({
          key,
          oldValue,
          newValue,
          hotReloadable: isHotReloadable,
        });
      }
    }

    return changes;
  }

  /**
   * Handle file change event (debounced)
   */
  private onFileChange = (): void => {
    // Debounce: wait 500ms after last change before processing
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processConfigChange();
      this.debounceTimer = null;
    }, 500);
  };

  /**
   * Process config file changes
   */
  private processConfigChange(): void {
    const newConfig = this.readEnvFile();
    const changes = this.detectChanges(this.currentConfig, newConfig);

    if (changes.length === 0) {
      return;
    }

    // Update current config
    this.currentConfig = newConfig;

    // Emit events for each change
    for (const change of changes) {
      this.emit("config:changed", change);
    }
  }

  /**
   * Start watching the .env file
   */
  start(): void {
    if (this.isRunning) {
      console.warn("[config-watcher] Already running");
      return;
    }

    if (!existsSync(this.envPath)) {
      console.warn(`[config-watcher] .env file not found at ${this.envPath}, skipping watch`);
      return;
    }

    try {
      this.watcher = watch(this.envPath, { persistent: false }, this.onFileChange);
      this.isRunning = true;
      console.log(`[config-watcher] Watching ${this.envPath} for changes`);
    } catch (error) {
      console.error("[config-watcher] Failed to start watching:", error);
    }
  }

  /**
   * Stop watching the .env file
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isRunning = false;
    console.log("[config-watcher] Stopped watching .env file");
  }

  /**
   * Get current effective config
   */
  getConfig(): ConfigData {
    return { ...this.currentConfig };
  }

  /**
   * Check if watcher is running
   */
  isWatching(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
export const configWatcher = new ConfigWatcher();
