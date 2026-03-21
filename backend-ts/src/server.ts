import express, { Request, Response } from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { existsSync, writeFileSync, unlinkSync, statSync } from "fs";
import path from "path";
import process from "process";
import { homedir } from "os";

import * as config from "./config.js";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as ptyService from "./pty-service.js";
import * as captain from "./captain.js";
import type { MessageSource } from "./captain.js";
import { createCaptainRouter } from "./captain-router.js";
import * as fleetMonitor from "./fleet-monitor.js";
import { log } from "./logger.js";
import { scheduler } from "./scheduler.js";
import { saveCaptainState, loadCaptainState } from './state-persistence.js';
import { buildSocketCallbacks } from "./socket/callbacks.js";
import { setupSocketHandlers } from "./socket/handlers.js";
import { createHealthRoutes } from "./routes/health.js";
import { createDataRoutes } from "./routes/data.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createFilesystemRoutes } from "./routes/filesystem.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createWorkspaceRoutes } from "./routes/workspace.js";
import { createImageRoutes } from "./routes/images.js";
import { createMiscRoutes } from "./routes/misc.js";

// Remove CLAUDECODE env var
delete process.env.CLAUDECODE;

// ---------------------------------------------------------------------------
// Application setup
// ---------------------------------------------------------------------------

const app = express();
const httpServer = createServer(app);

const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ??
  "http://localhost:4000,http://localhost:4001,http://localhost:3001,http://127.0.0.1:4000,http://127.0.0.1:4001,http://127.0.0.1:3001"
).split(",");

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", ...ALLOWED_ORIGINS],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json());

const io = new SocketIOServer(httpServer, {
  cors: { origin: ALLOWED_ORIGINS },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Wire fleet monitor to Socket.IO
fleetMonitor.setIOInstance(io);

const upload = multer({ storage: multer.memoryStorage() });

const START_TIME = Date.now();

// Mark orphaned tool events from previous run
const orphanCount = database.markOrphanedToolEvents();
if (orphanCount > 0) {
  log.info(`Marked ${orphanCount} orphaned tool events from previous run`, { orphanCount });
}

// Maps socket.id -> { session_id, sessions }
const connectedClients = new Map<string, { session_id: string; sessions: Set<string> }>();

// Track mutable workspace path (global default for new sessions)
let workspacePath = config.WORKSPACE_PATH;

// Per-session workspace paths (session_id -> workspace_path)
const sessionWorkspaces = new Map<string, string>();

// Helper: Get workspace path for a session (falls back to global default)
function getWorkspaceForSession(sessionId: string | undefined): string {
  if (sessionId && sessionWorkspaces.has(sessionId)) {
    return sessionWorkspaces.get(sessionId)!;
  }
  return workspacePath;
}

// Wrapper for buildSocketCallbacks with dependencies
function buildSocketCallbacksWithDeps(sessionId: string, projectPath: string | undefined) {
  return buildSocketCallbacks(sessionId, projectPath, { io, database, log });
}

// =========================================================================
// HTTP Routes
// =========================================================================

// -- Static files --

app.use(express.static(config.STATIC_DIR));

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(config.STATIC_DIR, "index.html"));
});

// -- Mount all routes --

createHealthRoutes(app, { database, sdkSession, connectedClients, START_TIME });
createDataRoutes(app, { database, sdkSession });
createProjectRoutes(app, { database, getWorkspaceForSession });
createFilesystemRoutes(app);
createSessionRoutes(app, { database, sdkSession, sessionWorkspaces, io, buildSocketCallbacks: buildSocketCallbacksWithDeps, log });
createWorkspaceRoutes(app, { database });
createImageRoutes(app, { database, upload });

// Set workspace (requires mutation of server-level state)
app.post("/api/set-workspace", (req: Request, res: Response) => {
  const { path: newPath, session_id: sessionId } = req.body ?? {};
  if (!newPath?.trim()) {
    res.status(400).json({ error: "Missing 'path' in request body" });
    return;
  }

  const resolved = path.resolve(newPath.trim());
  const homeDir = path.resolve(homedir());

  if (!resolved.startsWith(homeDir)) {
    res.status(403).json({ error: "Workspace must be within home directory" });
    return;
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    res.status(404).json({ error: "Path does not exist or is not a directory" });
    return;
  }

  // If session_id provided, store per-session; otherwise update global default
  if (sessionId?.trim()) {
    sessionWorkspaces.set(sessionId.trim(), resolved);
    log.info("Set workspace for session", { sessionId, workspace: resolved });
  } else {
    workspacePath = resolved;
    process.env.WORKSPACE_PATH = resolved;
    log.info("Set global workspace", { workspace: resolved });
  }

  res.json({ workspace: resolved });
});

// Captain router
const captainDeps = {
  database,
  sdkSession,
  sessionWorkspaces,
  io,
  buildSocketCallbacks: buildSocketCallbacksWithDeps,
  log,
};

const captainRouter = createCaptainRouter({
  getCaptainSessionId: captain.getCaptainSessionId,
  isCaptainAlive: captain.isCaptainAlive,
  getCaptainStatus: captain.getCaptainStatus,
  sendCaptainMessage: (content: string, source: string, sourceId: string) => {
    captain.sendCaptainMessage(content, source as MessageSource, sourceId);
  },
  startCaptainSession: (workspace) => captain.startCaptainSession(workspace, captainDeps),
  workspace: config.WORKSPACE_PATH ?? process.cwd(),
});

createMiscRoutes(app, { sdkSession, io, fleetMonitor, captainRouter });

// =========================================================================
// WebSocket Events
// =========================================================================

setupSocketHandlers(io, {
  connectedClients,
  database,
  sdkSession,
  ptyService,
  captain,
  scheduler,
  getWorkspaceForSession,
  buildSocketCallbacks: buildSocketCallbacksWithDeps,
});

// =========================================================================
// PID file management & Start
// =========================================================================

function writePidFile(): void {
  try {
    writeFileSync(config.SERVER_PID_PATH, String(process.pid));
  } catch (e) {
    log.error("Failed to write PID file", { pidPath: config.SERVER_PID_PATH, error: String(e) });
  }
}

function removePidFile(): void {
  try {
    if (existsSync(config.SERVER_PID_PATH)) {
      unlinkSync(config.SERVER_PID_PATH);
    }
  } catch {
    // ignore
  }
}

// Start server
log.info("Starting ccplus server", {
  host: config.HOST,
  port: config.PORT,
  workspace: workspacePath,
  database: config.DATABASE_PATH,
  staticDir: config.STATIC_DIR,
});

writePidFile();

function gracefulShutdown(signal: string): void {
  log.info("Received shutdown signal", { signal });

  // Save Captain state for resume on next startup
  const captainPersistState = captain.getCaptainStateForPersistence()
  if (captainPersistState) {
    saveCaptainState({ ...captainPersistState, savedAt: Date.now() }, config.CAPTAIN_STATE_PATH)
    log.info('Captain state saved for resume on next startup', { sdkSessionId: captainPersistState.sdkSessionId })
  }

  // Force exit after timeout if graceful shutdown hangs
  const forceExitTimeout = setTimeout(() => {
    log.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, 5000);
  forceExitTimeout.unref(); // Don't keep process alive just for this timer

  // 1. Stop accepting new connections
  httpServer.close(() => {
    console.log("HTTP server closed");
  });

  // 2. Close all active Socket.IO connections
  io.close(() => {
    console.log("Socket.IO server closed");
  });

  // 3. Close database connection
  database.close();
  console.log("Database closed");

  // 4. Stop Telegram bridge
  import('./telegram-bridge.js').then(({ stopTelegramBridge }) => {
    stopTelegramBridge().catch(() => {});
  }).catch(() => {});

  // 5. Remove PID file
  removePidFile();

  // 6. Exit
  console.log("Shutdown complete");
  clearTimeout(forceExitTimeout);
  process.exit(0);
}

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception (not crashing):", err);
});

process.on("unhandledRejection", (reason) => {
  const reasonStr = String(reason);
  if (reasonStr.includes("ProcessTransport is not ready for writing")) {
    return;
  }
  console.error("[server] Unhandled rejection (not crashing):", reason);
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("exit", removePidFile);

// ---- Scheduled tasks tick ----

setInterval(() => {
  // Get all active sessions from connectedClients
  const activeSessions = new Set<string>();
  for (const client of connectedClients.values()) {
    for (const sid of client.sessions) {
      activeSessions.add(sid);
    }
  }

  // Check each active session for ready tasks
  for (const sessionId of activeSessions) {
    // Only fire if session is idle
    if (!sdkSession.isActive(sessionId)) {
      const readyTasks = scheduler.getReadyTasks(sessionId);

      for (const task of readyTasks) {
        log.info(`Firing scheduled task ${task.id} for session ${sessionId}`, { taskId: task.id, prompt: task.prompt });

        // Record user message
        try {
          database.recordMessage(sessionId, "local", "user", task.prompt, undefined, undefined, undefined);
        } catch (err) {
          log.error("Failed to record scheduled task message", { sessionId, taskId: task.id, error: String(err) });
        }

        // Emit fired event
        io.to(sessionId).emit("schedule_fired", { id: task.id, prompt: task.prompt, timestamp: Date.now() });

        // Submit query
        const workspace = getWorkspaceForSession(sessionId);
        sdkSession.submitQuery(
          sessionId,
          task.prompt,
          workspace,
          buildSocketCallbacksWithDeps(sessionId, workspace),
          undefined,
          undefined,
          undefined, // requestedBy (not applicable for scheduled tasks)
        );

        // Mark task as fired
        scheduler.markFired(task.id);
      }
    }
  }
}, 5000); // Check every 5 seconds

httpServer.listen(config.PORT, config.HOST, () => {
  console.log(`ccplus server listening on http://${config.HOST}:${config.PORT}`);
  scheduler.start();

  // Auto-start Captain if enabled
  if (config.CAPTAIN_AUTO_START) {
    const persistedState = config.CAPTAIN_RESUME_ON_STARTUP
      ? loadCaptainState(config.CAPTAIN_STATE_PATH)
      : null

    if (persistedState) {
      log.info('Resuming Captain from persisted state', {
        sdkSessionId: persistedState.sdkSessionId,
        savedAt: new Date(persistedState.savedAt).toISOString(),
      })
    } else {
      log.info('Starting Captain fresh (no persisted state found)')
    }

    captain.startCaptainSession(
      persistedState?.workspace ?? config.CAPTAIN_WORKSPACE ?? process.cwd(),
      captainDeps,
      persistedState?.sdkSessionId
    )
      .then(({ sessionId }) => log.info('Captain session started', { sessionId, resumed: !!persistedState }))
      .catch((err: unknown) => log.error('Captain auto-start failed', { error: String(err) }))
  }

  // Auto-start Telegram bridge if token configured
  if (config.TELEGRAM_BOT_TOKEN) {
    import('./telegram-bridge.js').then(({ startTelegramBridge }) => {
      startTelegramBridge()
        .then(() => log.info('Telegram bridge started'))
        .catch((err: unknown) => log.error('Telegram bridge failed to start', { error: String(err) }));
    });
  }
});
