import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { ActiveSession } from "./types.js";
import * as config from "../config.js";
import { log } from "../logger.js";

// ---- Session Manager ----

export const sessions = new Map<string, ActiveSession>();

// Maximum buffer size for streaming content (2MB)
// This buffer is only used for reconnection sync, so trimming from the front is acceptable
export const MAX_STREAMING_BUFFER = 2 * 1024 * 1024;

export function getOrCreateSession(sessionId: string, workspace: string, model?: string): ActiveSession {
  const existing = sessions.get(sessionId);
  if (existing) {
    // If workspace or model changed, reset
    if (
      (existing.workspace && existing.workspace !== workspace) ||
      (model && existing.model && existing.model !== model)
    ) {
      // Interrupt existing query if running
      if (existing.activeQuery) {
        existing.activeQuery.interrupt().catch((err: Error) => {
          log.error("Failed to interrupt query during session reset", { sessionId, error: String(err) });
        });
      }
      sessions.delete(sessionId);
    } else {
      return existing;
    }
  }

  const session: ActiveSession = {
    sessionId,
    workspace,
    model: model ?? null,
    sdkSessionId: null,
    activeQuery: null,
    callbacks: null,
    cancelRequested: false,
    pendingQuestion: null,
    questionTimeout: null,
    streamingContent: '',
    latestTodos: null,
    hadToolSinceLastText: false,
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSdkSettingsPath(): string {
  const userSettingsPath = path.join(homedir(), ".claude", "settings.json");
  const sdkSettingsPath = path.join(config.DATA_DIR, "sdk_settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(userSettingsPath)) {
    try {
      settings = JSON.parse(readFileSync(userSettingsPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  // Disable plugins — their hooks can't resolve ${CLAUDE_PLUGIN_ROOT}
  delete settings.enabledPlugins;
  delete settings.extraKnownMarketplaces;

  writeFileSync(sdkSettingsPath, JSON.stringify(settings, null, 2));
  return sdkSettingsPath;
}
