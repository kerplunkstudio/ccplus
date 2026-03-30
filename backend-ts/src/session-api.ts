import { existsSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as fleetMonitor from "./fleet-monitor.js";
import { log } from "./logger.js";
import * as config from "./config.js";
import { loadWorkflow } from "./workflow-config.js";

// ---- Types ----

export interface StartSessionParams {
  prompt: string;
  workspace: string;
  model?: string;
  sessionId?: string;
  requestedBy?: { source: string; sourceId: string };
  agentId?: string;
  workflow?: string;
  description?: string;
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

export interface PendingSessionData {
  readonly prompt: string;
  readonly workspace: string;
  readonly model?: string;
  readonly requestedBy?: { source: string; sourceId: string };
  readonly agentId?: string;
  readonly workflow?: string;
  readonly createdAt: number;
}

// ---- Pending Session Store ----

const pendingSessionStore = new Map<string, PendingSessionData>();

export function storePendingSession(sessionId: string, data: PendingSessionData): void {
  pendingSessionStore.set(sessionId, data);
}

export function getPendingSession(sessionId: string): PendingSessionData | undefined {
  return pendingSessionStore.get(sessionId);
}

export function removePendingSession(sessionId: string): void {
  pendingSessionStore.delete(sessionId);
}

export function _clearPendingStore(): void {
  pendingSessionStore.clear();
}

// ---- Public API ----

/**
 * Create a pending session that requires user approval before starting.
 *
 * Validates inputs, registers in fleet monitor with 'pending' status, stores prompt data,
 * but does NOT submit query to SDK (that happens in approvePendingSession).
 */
export function createPendingSession(
  params: StartSessionParams,
  dependencies: SessionDependencies
): StartSessionResult {
  const { prompt, workspace, model, sessionId: providedSessionId, requestedBy, agentId, workflow } = params;
  const { sdkSession: sdk } = dependencies;

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

  const trimmedPrompt = prompt.trim();

  // Store pending session data
  storePendingSession(sessionId, {
    prompt: trimmedPrompt,
    workspace: resolvedWorkspace,
    model,
    requestedBy,
    agentId,
    workflow,
    createdAt: Date.now(),
  });

  // Register session in fleet monitor with 'pending' status
  fleetMonitor.registerSession(sessionId, resolvedWorkspace, requestedBy);
  fleetMonitor.updateSessionStatus(sessionId, 'pending');

  return {
    success: true,
    sessionId,
  };
}

/**
 * Approve a pending session and start it.
 *
 * Retrieves pending data, removes from store, records user message in DB,
 * stores workspace, and submits query to SDK.
 */
export function approvePendingSession(
  sessionId: string,
  dependencies: SessionDependencies
): StartSessionResult {
  const { database: db, sdkSession: sdk, sessionWorkspaces, buildSocketCallbacks } = dependencies;

  // Retrieve pending session data
  const pendingData = getPendingSession(sessionId);
  if (!pendingData) {
    return { success: false, error: "No pending session found with this ID" };
  }

  // Remove from pending store
  removePendingSession(sessionId);

  const uid = "local";

  // Determine if worktree should be enabled
  let worktreeEnabled = config.getWorktreeEnabled();
  if (pendingData.workflow) {
    const workflowConfig = loadWorkflow(pendingData.workflow, pendingData.workspace);
    if (workflowConfig.worktree !== undefined) {
      worktreeEnabled = workflowConfig.worktree;
    }
  }

  // Record user message in database
  try {
    db.recordMessage(
      sessionId,
      uid,
      "user",
      pendingData.prompt,
      undefined,
      pendingData.workspace,
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
  sessionWorkspaces.set(sessionId, pendingData.workspace);

  // Submit query to SDK (fire-and-forget, same as socket handler)
  sdk.submitQuery(
    sessionId,
    pendingData.prompt,
    pendingData.workspace,
    buildSocketCallbacks(sessionId, pendingData.workspace) as any,
    pendingData.model && typeof pendingData.model === "string" ? pendingData.model : undefined,
    undefined,
    pendingData.requestedBy,
    pendingData.agentId,
    pendingData.workflow
  );

  return {
    success: true,
    sessionId,
  };
}

/**
 * Reject a pending session.
 *
 * Retrieves pending data, removes from store, and updates status to 'cancelled'.
 */
export function rejectPendingSession(sessionId: string): StartSessionResult {
  // Retrieve pending session data
  const pendingData = getPendingSession(sessionId);
  if (!pendingData) {
    return { success: false, error: "No pending session found with this ID" };
  }

  // Remove from pending store
  removePendingSession(sessionId);

  // Update fleet monitor status to cancelled
  fleetMonitor.updateSessionStatus(sessionId, 'cancelled');

  return {
    success: true,
    sessionId,
  };
}

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
  const { prompt, workspace, model, sessionId: providedSessionId, requestedBy, agentId, workflow, description } = params;
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

  // Determine if worktree should be enabled
  let worktreeEnabled = config.getWorktreeEnabled();
  if (workflow) {
    const workflowConfig = loadWorkflow(workflow, resolvedWorkspace);
    if (workflowConfig.worktree !== undefined) {
      worktreeEnabled = workflowConfig.worktree;
    }
  }

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

  // If session was requested by Captain, emit session_proposal event to captain chat BEFORE submitQuery
  // (to ensure the proposal card renders before SDK events start arriving)
  if (requestedBy && requestedBy.source === 'captain' && requestedBy.sourceId) {
    const io = dependencies.io as any;
    if (io && typeof io.to === 'function') {
      const captainRoom = `captain:${requestedBy.sourceId}`;
      io.to(captainRoom).emit('session_proposal', {
        sessionId,
        prompt: trimmedPrompt,
        workspace: resolvedWorkspace,
        workflow: workflow ?? 'default',
        timestamp: Date.now(),
      });
    }
  }

  // Submit query to SDK (fire-and-forget, same as socket handler)
  sdk.submitQuery(
    sessionId,
    trimmedPrompt,
    resolvedWorkspace,
    buildSocketCallbacks(sessionId, resolvedWorkspace) as any,
    model && typeof model === "string" ? model : undefined,
    undefined,
    requestedBy,
    agentId,
    workflow,
    description
  );

  return {
    success: true,
    sessionId,
  };
}
