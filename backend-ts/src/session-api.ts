import { existsSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import { log } from "./logger.js";

// ---- Types ----

export interface StartSessionParams {
  prompt: string;
  workspace: string;
  model?: string;
  sessionId?: string;
}

export interface StartSessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

interface SessionDependencies {
  database: typeof database;
  sdkSession: typeof sdkSession;
  sessionWorkspaces: Map<string, string>;
  io: unknown;
  buildSocketCallbacks: (sessionId: string, projectPath?: string) => unknown;
  log: typeof log;
}

// ---- Public API ----

/**
 * Start a new coding session via the SDK.
 *
 * Validates inputs, records the user message, and submits the query to the SDK.
 * This function contains all the validation and session start logic extracted from
 * the POST /api/sessions/start HTTP handler.
 */
export function startSession(
  params: StartSessionParams,
  dependencies: SessionDependencies
): StartSessionResult {
  const { prompt, workspace, model, sessionId: providedSessionId } = params;
  const { database: db, sdkSession: sdk, sessionWorkspaces, buildSocketCallbacks } = dependencies;

  // Validate required fields
  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return { success: false, error: "prompt is required and must be a non-empty string" };
  }

  if (!workspace || typeof workspace !== "string") {
    return { success: false, error: "workspace is required and must be a string" };
  }

  // Validate model parameter if provided
  if (model !== undefined && (typeof model !== "string" || model.trim() === "")) {
    return { success: false, error: "model must be a non-empty string if provided" };
  }

  // Normalize and validate workspace path
  const resolvedWorkspace = path.resolve(workspace.trim());
  const homeDir = path.resolve(homedir());

  // Enforce home directory constraint
  if (!resolvedWorkspace.startsWith(homeDir)) {
    return { success: false, error: "Workspace must be within home directory" };
  }

  // Validate workspace path exists
  if (!existsSync(resolvedWorkspace) || !statSync(resolvedWorkspace).isDirectory()) {
    return { success: false, error: "workspace path does not exist or is not a directory" };
  }

  // Generate or validate session_id
  let sessionId: string;
  if (providedSessionId && typeof providedSessionId === "string") {
    // Validate session_id format: alphanumeric, dots, dashes, underscores, max 128 chars
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(providedSessionId)) {
      return {
        success: false,
        error: "session_id must be alphanumeric with dots, dashes, or underscores (max 128 characters)",
      };
    }
    sessionId = providedSessionId;
  } else {
    sessionId = uuidv4();
  }

  // Check if session already has an active query
  if (sdk.isActive(sessionId)) {
    return { success: false, error: "Session already has an active query running" };
  }

  const uid = "local";
  const trimmedPrompt = prompt.trim();

  // Record user message in database
  try {
    db.recordMessage(
      sessionId,
      uid,
      "user",
      trimmedPrompt,
      undefined,
      resolvedWorkspace,
      undefined
    );

    const existing = db.getConversationHistory(sessionId, 1);
    if (existing.length <= 1) {
      try {
        db.incrementUserStats(uid, 1);
      } catch (e) {
        log.error("Failed to increment session count", { sessionId, error: String(e) });
      }
    }
  } catch (err) {
    log.error("Failed to record user message", { sessionId, error: String(err) });
    return { success: false, error: "Failed to record message in database" };
  }

  // Store workspace for this session
  sessionWorkspaces.set(sessionId, resolvedWorkspace);

  // Submit query to SDK (fire-and-forget, same as socket handler)
  sdk.submitQuery(
    sessionId,
    trimmedPrompt,
    resolvedWorkspace,
    buildSocketCallbacks(sessionId, resolvedWorkspace) as any,
    model && typeof model === "string" ? model : undefined,
    undefined
  );

  return {
    success: true,
    sessionId,
  };
}
