import express, { Request, Response } from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { execFileSync } from "child_process";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import path from "path";
import process from "process";
import { homedir } from "os";

import * as config from "./config.js";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import * as ptyService from "./pty-service.js";
import { findClaudeBinary } from "./utils.js";
import { getAllMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from "./mcp-config.js";
import { log } from "./logger.js";
import { scheduler, validateCronExpression } from "./scheduler.js";
import { eventLog } from "./event-log.js";
import { getWorkflowState, skipToPhase, type WorkflowPhase } from './workflow-state.js';
import { WORKFLOW_ENABLED } from './config.js';

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

// =========================================================================
// HTTP Routes
// =========================================================================

// -- Static files --

app.use(express.static(config.STATIC_DIR));

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(config.STATIC_DIR, "index.html"));
});

// -- Health --

app.get("/health", (_req: Request, res: Response) => {
  let dbStats: Record<string, unknown> = {};
  try {
    dbStats = database.getStats();
  } catch {
    // ignore
  }
  res.json({
    status: "ok",
    version: config.VERSION,
    channel: config.CCPLUS_CHANNEL,
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    active_sessions: sdkSession.getActiveSessions().length,
    connected_clients: connectedClients.size,
    active_sessions_count: new Set([...connectedClients.values()].flatMap(c => [...c.sessions])).size,
    db: dbStats,
  });
});

// -- Version --

app.get("/api/version", (_req: Request, res: Response) => {
  let gitSha: string | null = null;
  try {
    gitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      timeout: 2000,
      cwd: config.PROJECT_ROOT,
      encoding: "utf-8",
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // ignore
  }
  res.json({ version: config.VERSION, channel: config.CCPLUS_CHANNEL, git_sha: gitSha });
});

// -- Update check (cached 1 hour) --

let updateCheckCache: { timestamp: number; result: Record<string, unknown> | null } = {
  timestamp: 0,
  result: null,
};

app.get("/api/update-check", (_req: Request, res: Response) => {
  const now = Date.now();
  if (updateCheckCache.result && (now - updateCheckCache.timestamp) < 3_600_000) {
    res.json(updateCheckCache.result);
    return;
  }

  let updateAvailable = false;
  let latestVersion = config.VERSION;

  try {
    execFileSync("git", ["fetch", "--tags", "--quiet"], {
      timeout: 10000,
      cwd: config.PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (config.CCPLUS_CHANNEL === "stable") {
      const tags = execFileSync("git", ["tag", "--sort=-v:refname"], {
        timeout: 2000,
        cwd: config.PROJECT_ROOT,
        encoding: "utf-8",
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (tags) {
        latestVersion = tags.split("\n")[0];
        updateAvailable = config.VERSION !== latestVersion;
      }
    } else {
      const countStr = execFileSync("git", ["rev-list", "HEAD..origin/main", "--count"], {
        timeout: 2000,
        cwd: config.PROJECT_ROOT,
        encoding: "utf-8",
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const commitsBehind = parseInt(countStr || "0", 10);
      updateAvailable = commitsBehind > 0;
      latestVersion = commitsBehind > 0 ? `main (+${commitsBehind})` : config.VERSION;
    }
  } catch {
    // ignore
  }

  const result = {
    update_available: updateAvailable,
    current_version: config.VERSION,
    latest_version: latestVersion,
    channel: config.CCPLUS_CHANNEL,
  };
  updateCheckCache = { timestamp: now, result };
  res.json(result);
});

// -- Status --

app.get("/api/status/first-run", (_req: Request, res: Response) => {
  res.json({ first_run: database.isFirstRun() });
});

// -- Data --

app.get("/api/history/:sessionId", (req: Request, res: Response) => {
  try {
    const messages = database.getConversationHistory(req.params.sessionId);
    const context = database.getSessionContext(req.params.sessionId);
    const isStreaming = sdkSession.isActive(req.params.sessionId);
    res.json({
      messages,
      streaming: isStreaming,
      streamingContent: isStreaming ? sdkSession.getStreamingContent(req.params.sessionId) : null,
      context_tokens: context?.input_tokens ?? null,
      model: context?.model ?? null,
    });
  } catch (err) {
    log.error("Failed to fetch history", { sessionId: req.params.sessionId, error: String(err) });
    res.status(500).json({ error: "Failed to load history" });
  }
});

app.get("/api/activity/:sessionId", (req: Request, res: Response) => {
  try {
    const events = database.getToolEvents(req.params.sessionId, config.getMaxActivityEvents());
    res.json({ events });
  } catch (err) {
    log.error("Failed to fetch activity", { sessionId: req.params.sessionId, error: String(err) });
    res.status(500).json({ error: "Failed to load activity" });
  }
});

app.get("/api/stats", (_req: Request, res: Response) => {
  try {
    res.json(database.getStats());
  } catch (err) {
    log.error("Failed to fetch stats", { error: String(err) });
    res.status(500).json({ error: "Failed to load stats" });
  }
});

app.get("/api/stats/user", (_req: Request, res: Response) => {
  try {
    res.json(database.getUserStats("local"));
  } catch (err) {
    log.error("Failed to fetch user stats", { userId: "local", error: String(err) });
    res.status(500).json({ error: "Failed to load user stats" });
  }
});

app.get("/api/insights", (req: Request, res: Response) => {
  let days = 30;
  try {
    days = parseInt(req.query.days as string ?? "30", 10);
    if (isNaN(days) || days < 1 || days > 365) days = 30;
    const project = (req.query.project as string) || undefined;
    const source = (req.query.source as string) || undefined;
    res.json(database.getInsights(days, project, source));
  } catch (err) {
    log.error("Failed to fetch insights", { days, error: String(err) });
    res.status(500).json({ error: "Failed to load insights" });
  }
});

// POST /api/import/sessions - Trigger historical session import
app.post("/api/import/sessions", async (req: Request, res: Response) => {
  try {
    const { importSessions } = await import("./session-import.js");
    const result = importSessions();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Import failed" });
  }
});

// GET /api/import/status - Get import statistics
app.get("/api/import/status", (req: Request, res: Response) => {
  try {
    const status = database.getImportStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed to get import status" });
  }
});

app.get("/api/search", (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || "";
    if (!query || query.trim().length === 0) {
      return res.json({ success: true, results: [] });
    }
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const project = (req.query.project as string) || undefined;
    const results = database.searchConversations(query.trim(), project, limit);
    res.json({ success: true, results });
  } catch (err) {
    log.error("Failed to search conversations", { query: req.query.q, error: String(err) });
    res.status(500).json({ success: false, error: "Failed to search conversations" });
  }
});

// -- Projects --

app.get("/api/projects", (req: Request, res: Response) => {
  try {
    const sessionId = (req.query.session_id as string) || undefined;
    const workspaceForSession = getWorkspaceForSession(sessionId);
    const ws = path.resolve(workspaceForSession);
    const projects: { name: string; path: string }[] = [];
    for (const name of readdirSync(ws).sort()) {
      const fullPath = path.join(ws, name);
      if (!name.startsWith(".") && statSync(fullPath).isDirectory()) {
        projects.push({ name, path: fullPath });
      }
    }
    res.json({ projects, workspace: workspaceForSession });
  } catch (err) {
    log.error("Failed to list projects", { error: String(err) });
    res.status(500).json({ error: "Failed to list projects" });
  }
});

app.post("/api/projects/clone", (req: Request, res: Response) => {
  const { url, session_id: sessionId } = req.body ?? {};
  if (!url?.trim()) {
    res.status(400).json({ error: "Missing 'url' in request body" });
    return;
  }

  const repoUrl = url.trim();
  const githubPattern = /^(https?:\/\/github\.com\/|git@github\.com:)[\w-]+\/[\w-]+(?:\.git)?$/;
  if (!githubPattern.test(repoUrl)) {
    res.status(400).json({ error: "Invalid GitHub URL format" });
    return;
  }

  const repoName = repoUrl.replace(/\/$/, "").replace(/\.git$/, "").split("/").pop()!;
  const workspaceForSession = getWorkspaceForSession(sessionId);
  const targetPath = path.join(path.resolve(workspaceForSession), repoName);

  if (existsSync(targetPath)) {
    res.status(409).json({ error: `Directory '${repoName}' already exists in workspace` });
    return;
  }

  try {
    execFileSync("git", ["clone", repoUrl, targetPath], { timeout: 300_000, stdio: ['pipe', 'pipe', 'pipe'] });
    res.json({ name: repoName, path: targetPath });
  } catch (err) {
    log.error("Git clone failed", { repoUrl, destPath: targetPath, error: String(err) });
    res.status(500).json({ error: "Failed to clone repository" });
  }
});

// -- Filesystem browsing --

app.get("/api/browse", (req: Request, res: Response) => {
  let requestedPath = (req.query.path as string ?? "").trim();
  if (!requestedPath) requestedPath = homedir();

  let currentPath: string;
  try {
    currentPath = path.resolve(requestedPath);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  const homeDir = path.resolve(homedir());
  if (!currentPath.startsWith(homeDir)) {
    res.status(403).json({ error: "Access denied: path is outside home directory" });
    return;
  }

  if (!existsSync(currentPath) || !statSync(currentPath).isDirectory()) {
    res.status(404).json({ error: "Path does not exist or is not a directory" });
    return;
  }

  const parentPath = currentPath !== homeDir ? path.dirname(currentPath) : null;
  const entries: Record<string, unknown>[] = [];

  try {
    for (const name of readdirSync(currentPath).sort()) {
      if (name.startsWith(".")) continue;
      const fullPath = path.join(currentPath, name);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }
      entries.push({
        name,
        path: fullPath,
        is_dir: true,
        is_git: existsSync(path.join(fullPath, ".git")),
      });
    }
  } catch {
    res.status(403).json({ error: "Permission denied" });
    return;
  }

  res.json({ path: currentPath, parent: parentPath, entries });
});

// -- Path completion --

app.get("/api/path-complete", (req: Request, res: Response) => {
  let partialPath = (req.query.partial as string ?? "").trim();
  if (!partialPath) {
    res.json({ entries: [], basePath: "" });
    return;
  }

  // Resolve ~ to home directory
  if (partialPath.startsWith("~/")) {
    partialPath = path.join(homedir(), partialPath.slice(2));
  } else if (partialPath === "~") {
    partialPath = homedir();
  }

  // Resolve ./ paths relative to project directory
  if (partialPath.startsWith("./") || partialPath === ".") {
    const projectDir = (req.query.project as string ?? "").trim();
    if (projectDir) {
      // Security: ensure project directory is within home directory
      const homeDir = path.resolve(homedir());
      const resolvedProject = path.resolve(projectDir);
      if (resolvedProject.startsWith(homeDir)) {
        // Resolve relative to project directory
        partialPath = path.join(projectDir, partialPath.slice(partialPath === "." ? 1 : 2));
      }
    }
  }

  // Security: ensure path is within home directory
  const homeDir = path.resolve(homedir());
  let resolvedBase: string;
  try {
    resolvedBase = path.resolve(partialPath);
  } catch {
    res.json({ entries: [], basePath: "" });
    return;
  }

  // If path doesn't start with home dir, reject
  if (!resolvedBase.startsWith(homeDir)) {
    res.json({ entries: [], basePath: "" });
    return;
  }

  // Determine the directory to list and the filename prefix to match
  let dirToList: string;
  let filePrefix: string;

  if (existsSync(resolvedBase) && statSync(resolvedBase).isDirectory()) {
    // Path is a complete directory - list its contents
    dirToList = resolvedBase;
    filePrefix = "";
  } else {
    // Path is partial - list parent directory and filter by filename
    dirToList = path.dirname(resolvedBase);
    filePrefix = path.basename(resolvedBase);
  }

  // Ensure directory exists and is accessible
  if (!existsSync(dirToList) || !statSync(dirToList).isDirectory()) {
    res.json({ entries: [], basePath: "" });
    return;
  }

  // Read directory entries
  const entries: Array<{ name: string; path: string; isDir: boolean }> = [];
  try {
    const items = readdirSync(dirToList);

    for (const name of items) {
      // Skip hidden files by default
      if (name.startsWith(".")) continue;

      // Filter by prefix
      if (filePrefix && !name.toLowerCase().startsWith(filePrefix.toLowerCase())) {
        continue;
      }

      const fullPath = path.join(dirToList, name);
      try {
        const stat = statSync(fullPath);
        entries.push({
          name: stat.isDirectory() ? `${name}/` : name,
          path: fullPath,
          isDir: stat.isDirectory(),
        });

        // Limit results
        if (entries.length >= 20) break;
      } catch {
        // Skip inaccessible entries
        continue;
      }
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  } catch {
    // Permission denied or other error
    res.json({ entries: [], basePath: dirToList });
    return;
  }

  res.json({ entries, basePath: dirToList });
});

// -- Scan projects --

app.get("/api/scan-projects", (_req: Request, res: Response) => {
  const home = homedir();
  const commonLocations = [
    "Workspace", "Projects", "Developer", "Code", "repos", "Documents/GitHub", "src",
  ].map((d) => path.join(home, d));

  const detectedProjects: { name: string; path: string }[] = [];
  const maxResults = 50;

  function scanDir(dir: string, depth: number): void {
    if (detectedProjects.length >= maxResults || depth > 2) return;
    try {
      for (const name of readdirSync(dir)) {
        if (detectedProjects.length >= maxResults) break;
        if (name.startsWith(".")) continue;
        const fullPath = path.join(dir, name);
        try {
          if (!statSync(fullPath).isDirectory()) continue;
        } catch {
          continue;
        }
        if (existsSync(path.join(fullPath, ".git"))) {
          detectedProjects.push({ name, path: fullPath });
          continue;
        }
        scanDir(fullPath, depth + 1);
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  for (const loc of commonLocations) {
    if (detectedProjects.length >= maxResults) break;
    if (existsSync(loc) && statSync(loc).isDirectory()) {
      scanDir(loc, 0);
    }
  }

  res.json({ projects: detectedProjects });
});

// -- Set workspace --

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

// -- Git context --

app.get("/api/git/context", (req: Request, res: Response) => {
  const projectPath = (req.query.project as string ?? "").trim();
  if (!projectPath) {
    res.status(400).json({ error: "project parameter required" });
    return;
  }

  const sessionId = (req.query.session_id as string) || undefined;
  const workspaceForSession = getWorkspaceForSession(sessionId);
  const projectDir = path.resolve(projectPath);
  const wsDir = path.resolve(workspaceForSession);
  if (!projectDir.startsWith(wsDir)) {
    res.status(403).json({ error: "Project path is outside the configured workspace" });
    return;
  }

  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    res.status(400).json({ error: "Project path does not exist" });
    return;
  }

  const result: Record<string, unknown> = {};

  try {
    result.branch = execFileSync("git", ["-C", projectDir, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 5000, encoding: "utf-8", stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: "C" },
    }).trim();
  } catch {
    result.branch = null;
  }

  try {
    const status = execFileSync("git", ["-C", projectDir, "status", "--porcelain"], {
      timeout: 5000, encoding: "utf-8", stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: "C" },
    }).trim();
    result.dirty_count = status ? status.split("\n").filter(Boolean).length : 0;
  } catch {
    result.dirty_count = 0;
  }

  try {
    const log = execFileSync("git", ["-C", projectDir, "log", "--format=%H|||%h|||%s|||%ar", "-n", "5"], {
      timeout: 5000, encoding: "utf-8", stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: "C" },
    }).trim();
    result.commits = log
      ? log.split("\n").map((line) => {
          const [, shortHash, subject, timeAgo] = line.split("|||");
          return {
            hash: shortHash,
            message: subject?.length > 60 ? subject.slice(0, 57) + "..." : subject,
            time_ago: timeAgo,
          };
        })
      : [];
  } catch {
    result.commits = [];
  }

  res.json(result);
});

// -- Sessions --

app.get("/api/sessions", (req: Request, res: Response) => {
  try {
    const project = (req.query.project as string) || undefined;
    res.json({ sessions: database.getSessionsList(50, project) });
  } catch (err) {
    log.error("Failed to list sessions", { error: String(err) });
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

app.post("/api/sessions/:sessionId/archive", (req: Request, res: Response) => {
  try {
    const success = database.archiveSession(req.params.sessionId);
    if (success) {
      res.json({ status: "archived" });
    } else {
      res.status(500).json({ error: "Failed to archive session" });
    }
  } catch (err) {
    log.error("Failed to archive session", { sessionId: req.params.sessionId, error: String(err) });
    res.status(500).json({ error: "Failed to archive session" });
  }
});

// -- Workspace state --

app.get("/api/workspace", (_req: Request, res: Response) => {
  const state = database.getWorkspaceState("local");
  if (!state) {
    res.json({ projects: [], activeProjectPath: null });
    return;
  }
  res.json(state);
});

app.put("/api/workspace", (req: Request, res: Response) => {
  const state = req.body;
  if (!state || typeof state !== "object" || Object.keys(state).length === 0) {
    res.status(400).json({ error: "No state provided" });
    return;
  }
  database.saveWorkspaceState("local", state);
  res.json({ status: "ok" });
});

app.post("/api/workspace", (req: Request, res: Response) => {
  // POST variant for sendBeacon during page unload
  const state = req.body;
  if (!state || typeof state !== "object" || Object.keys(state).length === 0) {
    res.status(400).json({ error: "No state provided" });
    return;
  }
  database.saveWorkspaceState("local", state);
  res.json({ status: "ok" });
});

// -- Images --

app.post("/api/images/upload", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const sessionId = req.body?.session_id;
  if (!sessionId) {
    res.status(400).json({ error: "session_id required" });
    return;
  }

  const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);
  if (!allowedTypes.has(req.file.mimetype)) {
    res.status(400).json({ error: `Unsupported image type: ${req.file.mimetype}` });
    return;
  }

  if (req.file.size > 10 * 1024 * 1024) {
    res.status(400).json({ error: "File too large (max 10MB)" });
    return;
  }

  const imageId = uuidv4();
  try {
    const meta = database.storeImage(
      imageId,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      req.file.buffer,
      sessionId,
    );
    res.json(meta);
  } catch (err) {
    log.error("Failed to store image", { sessionId, filename: req.file?.originalname, error: String(err) });
    res.status(500).json({ error: "Failed to store image" });
  }
});

app.get("/api/images/:imageId", (req: Request, res: Response) => {
  try {
    const image = database.getImage(req.params.imageId);
    if (!image) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
    res.set("Content-Type", image.mime_type as string);
    res.set("Content-Disposition", `inline; filename="${image.filename}"`);
    res.send(image.data as Buffer);
  } catch (err) {
    log.error("Failed to retrieve image", { imageId: req.params.imageId, error: String(err) });
    res.status(500).json({ error: "Failed to retrieve image" });
  }
});

// -- Project overview (simplified) --

app.get("/api/project/overview", (req: Request, res: Response) => {
  const projectPath = (req.query.project as string ?? "").trim();
  if (!projectPath) {
    res.status(400).json({ error: "project parameter required" });
    return;
  }

  const sessionId = (req.query.session_id as string) || undefined;
  const workspaceForSession = getWorkspaceForSession(sessionId);
  const projectDir = path.resolve(projectPath);
  const wsDir = path.resolve(workspaceForSession);
  if (!projectDir.startsWith(wsDir)) {
    res.status(403).json({ error: "Project path is outside the configured workspace" });
    return;
  }

  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    res.status(400).json({ error: "Project path does not exist or is not a directory" });
    return;
  }

  const result: Record<string, unknown> = {
    name: path.basename(projectDir),
    path: projectDir,
  };

  // Git context
  try {
    const branch = execFileSync("git", ["-C", projectDir, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 5000, encoding: "utf-8", stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const status = execFileSync("git", ["-C", projectDir, "status", "--porcelain"], {
      timeout: 5000, encoding: "utf-8", stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    result.git = { branch, dirty_count: status ? status.split("\n").filter(Boolean).length : 0 };
  } catch {
    result.git = null;
  }

  // File tree (top-level)
  const ignorePatterns = new Set([".git", "node_modules", "__pycache__", "venv", ".env", "build", "dist", ".DS_Store", ".idea", ".vscode"]);
  try {
    const entries: string[] = [];
    const items = readdirSync(projectDir)
      .filter((n) => !n.startsWith(".") && !ignorePatterns.has(n))
      .sort((a, b) => {
        const aDir = statSync(path.join(projectDir, a)).isDirectory();
        const bDir = statSync(path.join(projectDir, b)).isDirectory();
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.localeCompare(b);
      });
    for (const name of items.slice(0, 30)) {
      const isDir = statSync(path.join(projectDir, name)).isDirectory();
      entries.push(name + (isDir ? "/" : ""));
    }
    result.file_tree = entries;
  } catch {
    result.file_tree = [];
  }

  // Languages + tech stack detection (simplified)
  const extToLang: Record<string, string> = {
    ".py": "Python", ".tsx": "TypeScript", ".ts": "TypeScript", ".jsx": "JavaScript",
    ".js": "JavaScript", ".css": "CSS", ".html": "HTML", ".json": "JSON",
    ".md": "Markdown", ".sql": "SQL", ".sh": "Shell", ".rs": "Rust",
    ".go": "Go", ".java": "Java", ".rb": "Ruby", ".swift": "Swift",
  };
  const langCounts: Record<string, number> = {};
  let totalFiles = 0;

  function scanLangs(dir: string, depth: number): void {
    if (depth > 4) return;
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith(".") || ignorePatterns.has(name)) continue;
        const fullPath = path.join(dir, name);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            const ext = path.extname(name).toLowerCase();
            if (ext in extToLang) {
              langCounts[extToLang[ext]] = (langCounts[extToLang[ext]] ?? 0) + 1;
              totalFiles++;
            }
          } else if (stat.isDirectory()) {
            scanLangs(fullPath, depth + 1);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }
  scanLangs(projectDir, 0);

  const total = Object.values(langCounts).reduce((a, b) => a + b, 0);
  result.languages = Object.entries(langCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({
      name,
      files: count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }));
  result.file_count = totalFiles;

  // Commit count
  try {
    const count = execFileSync("git", ["-C", projectDir, "rev-list", "--count", "HEAD"], {
      timeout: 5000, encoding: "utf-8", stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    result.commit_count = parseInt(count, 10);
  } catch {
    result.commit_count = 0;
  }

  // Tech stack
  const techStack: string[] = [];
  const pkgJsonPath = path.join(projectDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ("react" in deps) techStack.push("React");
      if ("vue" in deps) techStack.push("Vue");
      if ("next" in deps) techStack.push("Next.js");
      if ("express" in deps) techStack.push("Express");
      if ("typescript" in deps || existsSync(path.join(projectDir, "tsconfig.json"))) techStack.push("TypeScript");
    } catch {
      // ignore
    }
  }
  if (existsSync(path.join(projectDir, "requirements.txt")) || existsSync(path.join(projectDir, "pyproject.toml"))) techStack.push("Python");
  if (existsSync(path.join(projectDir, "Cargo.toml"))) techStack.push("Rust");
  if (existsSync(path.join(projectDir, "go.mod"))) techStack.push("Go");
  if (existsSync(path.join(projectDir, "Dockerfile"))) techStack.push("Docker");
  result.tech_stack = techStack;

  // CLAUDE.md
  const claudeMdPath = path.join(projectDir, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    try {
      let content = readFileSync(claudeMdPath, "utf-8");
      if (content.startsWith("---")) {
        const parts = content.split("---");
        if (parts.length >= 3) content = parts.slice(2).join("---").trim();
      }
      const excerpt = content.length > 200 ? content.slice(0, 197) + "..." : content;
      result.claude_md = { exists: true, excerpt };
    } catch {
      result.claude_md = { exists: true, excerpt: null };
    }
  } else {
    result.claude_md = { exists: false, excerpt: null };
  }

  // Sessions
  try {
    result.sessions = database.getSessionsList(20, projectDir);
  } catch {
    result.sessions = [];
  }

  // Stats
  result.stats = {
    total_sessions: 0,
    total_cost: 0,
    total_duration_ms: 0,
    total_tools: 0,
    lines_of_code: 0,
  };
  result.recent_activity = [];

  res.json(result);
});

// -- Plugins (stub) --

app.get("/api/plugins", (_req: Request, res: Response) => {
  res.json({ plugins: [] });
});

app.get("/api/plugins/marketplace", (_req: Request, res: Response) => {
  res.json({ plugins: [] });
});

app.get("/api/skills", (req: Request, res: Response) => {
  const projectPath = req.query.project as string | undefined;
  const skills = sdkSession.discoverSkills(projectPath);
  res.json({ skills });
});

// -- MCP Servers --

app.get("/api/mcp/servers", (req: Request, res: Response) => {
  try {
    const projectPath = req.query.project as string | undefined;
    const servers = getAllMcpServers(projectPath);
    res.json({ servers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/api/mcp/servers", (req: Request, res: Response) => {
  try {
    const { name, config, scope, projectPath } = req.body;

    if (!name || !config) {
      res.status(400).json({ error: 'name and config are required' });
      return;
    }

    if (!scope || !['user', 'project'].includes(scope)) {
      res.status(400).json({ error: 'scope must be "user" or "project"' });
      return;
    }

    if (scope === 'project' && !projectPath) {
      res.status(400).json({ error: 'projectPath is required for project scope' });
      return;
    }

    addMcpServer(name, config as McpServerConfig, scope, projectPath);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.delete("/api/mcp/servers/:name", (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { scope, projectPath } = req.query as { scope?: string; projectPath?: string };

    if (!scope || !['user', 'project'].includes(scope)) {
      res.status(400).json({ error: 'scope query param must be "user" or "project"' });
      return;
    }

    const removed = removeMcpServer(name, scope as 'user' | 'project', projectPath);
    if (removed) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: `Server "${name}" not found in ${scope} scope` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// -- Workflow state --

app.get("/api/workflow/:sessionId", (req: Request, res: Response) => {
  if (!WORKFLOW_ENABLED) {
    res.json({ enabled: false });
    return;
  }
  const state = getWorkflowState(req.params.sessionId);
  res.json({ enabled: true, ...state });
});

app.post("/api/workflow/:sessionId/transition", (req: Request, res: Response) => {
  if (!WORKFLOW_ENABLED) {
    res.status(400).json({ error: 'Workflow not enabled' });
    return;
  }
  const { phase } = req.body as { phase?: string };
  const validPhases: WorkflowPhase[] = ['idle', 'design', 'plan', 'execute', 'test', 'review', 'complete'];
  if (!phase || !validPhases.includes(phase as WorkflowPhase)) {
    res.status(400).json({ error: 'Invalid phase' });
    return;
  }
  const state = skipToPhase(req.params.sessionId, phase as WorkflowPhase);
  if (!state) {
    res.status(500).json({ error: 'Failed to update workflow state' });
    return;
  }
  io.to(req.params.sessionId).emit('workflow_phase', {
    phase: state.phase,
    previous: state.transitions.at(-1)?.from ?? 'idle',
    sessionId: req.params.sessionId,
  });
  res.json(state);
});

// =========================================================================
// WebSocket Events
// =========================================================================

// Helper: Join a session room and sync state
function joinSession(socket: import("socket.io").Socket, sessionId: string, userId: string, lastSeq = 0): void {
  // Check if full reset is required (client is too far behind)
  if (lastSeq > 0 && eventLog.fullResetRequired(sessionId, lastSeq)) {
    socket.emit("full_reset_required", { session_id: sessionId });
    return;
  }

  // Replay missed events if client provides lastSeq
  if (lastSeq > 0) {
    const missedEvents = eventLog.getEventsSince(sessionId, lastSeq);
    for (const event of missedEvents) {
      socket.emit(event.type, { ...event.data, seq: event.seq, replay: true });
    }
  }

  socket.join(sessionId);

  const client = connectedClients.get(socket.id);
  if (client) {
    client.sessions.add(sessionId);
    client.session_id = sessionId;
  }

  // Check if session has active query — re-register callbacks
  if (sdkSession.isActive(sessionId)) {
    const sessionProjectPath = getWorkspaceForSession(sessionId);
    sdkSession.registerCallbacks(sessionId, buildSocketCallbacks(sessionId, sessionProjectPath));

    const payload = { session_id: sessionId };
    const event = eventLog.append(sessionId, 'stream_active', payload);
    socket.emit("stream_active", { ...payload, seq: event.seq });

    const bufferedContent = sdkSession.getStreamingContent(sessionId);
    if (bufferedContent) {
      socket.emit("stream_content_sync", { content: bufferedContent, session_id: sessionId });
    }

    const pq = sdkSession.getPendingQuestion(sessionId);
    if (pq) {
      socket.emit("user_question", {
        questions: pq.questions ?? [],
        tool_use_id: pq.tool_use_id ?? "",
      });
    }

    // Sync todos from active session
    const todos = sdkSession.getSessionTodos(sessionId);
    if (todos) {
      socket.emit("todo_sync", { todos, session_id: sessionId });
    }
  } else {
    // Session not active - query database for last TodoWrite event
    try {
      const events = database.getToolEvents(sessionId);
      const lastTodoEvent = [...events].reverse().find(
        (e) => e.tool_name === 'TodoWrite' && typeof e.parameters === 'object' && e.parameters !== null && 'todos' in e.parameters
      );
      if (lastTodoEvent && typeof lastTodoEvent.parameters === 'object' && lastTodoEvent.parameters !== null && 'todos' in lastTodoEvent.parameters) {
        socket.emit("todo_sync", { todos: (lastTodoEvent.parameters as { todos: unknown }).todos, session_id: sessionId });
      }
    } catch (err) {
      // Failed to query todos - safe to ignore
    }
  }

  socket.emit("connected", { session_id: sessionId });
}

io.on("connection", (socket) => {
  const sessionId = (socket.handshake.auth.session_id as string) ?? "";

  connectedClients.set(socket.id, { session_id: sessionId, sessions: new Set() });

  // If session_id provided in auth (backward compat or initial connect), auto-join
  if (sessionId) {
    joinSession(socket, sessionId, "local");
  }

  // -- Message handler --

  socket.on("message", (data: Record<string, unknown>) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      socket.emit("error", { message: "Not connected" });
      return;
    }

    const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
    const uid = "local";
    const content = ((data?.content as string) ?? "").trim();
    const workspace = (data?.workspace as string) ?? getWorkspaceForSession(sid);
    const model = (data?.model as string) || undefined;
    const imageIdsData = (data?.image_ids as string[]) ?? [];
    const projectPathData = (data?.workspace as string) ?? "";

    if (!content && !imageIdsData.length) return;

    // Record user message
    try {
      database.recordMessage(
        sid, uid, "user",
        content || "[Image]",
        undefined,
        projectPathData || undefined,
        imageIdsData.length ? imageIdsData : undefined,
      );

      const existing = database.getConversationHistory(sid, 1);
      if (existing.length <= 1) {
        try {
          database.incrementUserStats(uid, 1);
        } catch (e) {
          log.error("Failed to increment session count", { error: String(e) });
        }
      }
    } catch (err) {
      log.error("Failed to record user message", { sessionId, error: String(err) });
    }

    socket.emit("message_received", { status: "ok" });

    // Submit to SDK
    sdkSession.submitQuery(
      sid,
      content || "[Image attached]",
      workspace,
      buildSocketCallbacks(sid, projectPathData || undefined),
      model,
      imageIdsData.length ? imageIdsData : undefined,
    );
  });

  // -- Cancel --

  socket.on("cancel", (data?: { session_id?: string }) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
    sdkSession.cancelQuery(sid);
    socket.emit("cancelled", { status: "ok" });
  });

  // -- Ping --

  socket.on("ping", () => {
    socket.emit("pong", { timestamp: Date.now() });
  });

  // -- Question response --

  socket.on("question_response", (data: Record<string, unknown>) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
    const response = (data?.response as Record<string, unknown>) ?? {};
    sdkSession.sendQuestionResponse(sid, response);
  });

  // -- Duplicate session --

  socket.on("duplicate_session", (data: { sourceSessionId: string; newSessionId: string }, callback?: (response: { success: boolean; error?: string; conversations?: number; toolEvents?: number; images?: number }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ success: false, error: "Not connected" });
      return;
    }

    try {
      const result = database.duplicateSession(data.sourceSessionId, data.newSessionId, "local");
      callback?.({ success: true, conversations: result.conversations, toolEvents: result.toolEvents, images: result.images });
    } catch (err) {
      log.error("Failed to duplicate session", { sourceSessionId: data.sourceSessionId, newSessionId: data.newSessionId, error: String(err) });
      callback?.({ success: false, error: String(err) });
    }
  });

  // -- Join session (room-based multiplexing) --

  socket.on("join_session", (data: { session_id: string; last_seq?: number; lastSeq?: number }, callback?: (response: { status: string }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ status: "error" });
      return;
    }

    const newSessionId = data?.session_id;
    if (!newSessionId || typeof newSessionId !== "string") {
      callback?.({ status: "error" });
      return;
    }

    const lastSeq = (data?.last_seq ?? data?.lastSeq ?? 0) as number;
    joinSession(socket, newSessionId, "local", lastSeq);
    callback?.({ status: "ok" });
  });

  // -- Leave session --

  socket.on("leave_session", (data: { session_id: string }) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;

    const oldSessionId = data?.session_id;
    if (!oldSessionId || typeof oldSessionId !== "string") return;

    socket.leave(oldSessionId);
    client.sessions.delete(oldSessionId);
  });

  // -- Scheduled tasks --

  socket.on("schedule_create", (data: { prompt: string; interval: string; session_id?: string }, callback?: (response: { success: boolean; error?: string; task?: unknown }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ success: false, error: "Not authenticated" });
      return;
    }

    const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
    const prompt = data?.prompt?.trim();
    const interval = data?.interval?.trim();

    if (!prompt || !interval) {
      callback?.({ success: false, error: "Missing prompt or interval" });
      return;
    }

    try {
      validateCronExpression(interval);
      const task = scheduler.addTask(sid, prompt, interval);
      callback?.({ success: true, task });
      socket.emit("schedule_created", { task });
    } catch (err) {
      const errorMsg = String(err);
      log.error("Failed to create scheduled task", { sessionId: sid, error: errorMsg });
      callback?.({ success: false, error: errorMsg });
    }
  });

  socket.on("schedule_delete", (data: { id: string }, callback?: (response: { success: boolean; error?: string }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ success: false, error: "Not authenticated" });
      return;
    }

    const taskId = data?.id;
    if (!taskId) {
      callback?.({ success: false, error: "Missing task id" });
      return;
    }

    const removed = scheduler.removeTask(taskId);
    if (removed) {
      callback?.({ success: true });
      socket.emit("schedule_deleted", { id: taskId });
    } else {
      callback?.({ success: false, error: "Task not found" });
    }
  });

  socket.on("schedule_list", (data: { session_id?: string }, callback?: (response: { tasks: unknown[] }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ tasks: [] });
      return;
    }

    const sid = (typeof data?.session_id === "string" && data.session_id) || client.session_id;
    const tasks = scheduler.listTasks(sid);
    callback?.({ tasks });
    socket.emit("schedule_list", { tasks });
  });

  socket.on("schedule_pause", (data: { id: string }, callback?: (response: { success: boolean; error?: string; task?: unknown }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ success: false, error: "Not authenticated" });
      return;
    }

    const taskId = data?.id;
    if (!taskId) {
      callback?.({ success: false, error: "Missing task id" });
      return;
    }

    const paused = scheduler.pauseTask(taskId);
    if (paused) {
      const tasks = scheduler.listTasks(client.session_id);
      const task = tasks.find(t => t.id === taskId);
      callback?.({ success: true, task });
      socket.emit("schedule_updated", { task });
    } else {
      callback?.({ success: false, error: "Task not found" });
    }
  });

  socket.on("schedule_resume", (data: { id: string }, callback?: (response: { success: boolean; error?: string; task?: unknown }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ success: false, error: "Not authenticated" });
      return;
    }

    const taskId = data?.id;
    if (!taskId) {
      callback?.({ success: false, error: "Missing task id" });
      return;
    }

    const resumed = scheduler.resumeTask(taskId);
    if (resumed) {
      const tasks = scheduler.listTasks(client.session_id);
      const task = tasks.find(t => t.id === taskId);
      callback?.({ success: true, task });
      socket.emit("schedule_updated", { task });
    } else {
      callback?.({ success: false, error: "Task not found" });
    }
  });

  // -- Terminal handlers --

  const socketTerminals = new Set<string>();

  socket.on("terminal_spawn", (data: { terminalId: string; cwd: string }) => {
    const { terminalId, cwd } = data;

    try {
      ptyService.spawnTerminal(
        terminalId,
        cwd,
        (output: string) => {
          socket.emit("terminal_output", { terminalId, data: output });
        },
        (exitCode: number) => {
          socket.emit("terminal_exit", { terminalId, exitCode });
          socketTerminals.delete(terminalId);
        }
      );
      socketTerminals.add(terminalId);
      socket.emit("terminal_spawned", { terminalId });
    } catch (error) {
      log.error("Failed to spawn terminal", { terminalId, error: String(error) });
      socket.emit("terminal_error", { terminalId, error: String(error) });
    }
  });

  socket.on("terminal_input", (data: { terminalId: string; data: string }) => {
    const { terminalId, data: input } = data;
    ptyService.writeTerminal(terminalId, input);
  });

  socket.on("terminal_resize", (data: { terminalId: string; cols: number; rows: number }) => {
    const { terminalId, cols, rows } = data;
    ptyService.resizeTerminal(terminalId, cols, rows);
  });

  socket.on("terminal_kill", (data: { terminalId: string }) => {
    const { terminalId } = data;
    ptyService.killTerminal(terminalId);
    socketTerminals.delete(terminalId);
  });

  // -- Disconnect --

  socket.on("disconnect", () => {
    const client = connectedClients.get(socket.id);
    connectedClients.delete(socket.id);
    if (client) {
      log.debug("Client disconnected", { sessions: [...client.sessions] });
    }

    // Kill all terminals owned by this socket
    for (const terminalId of socketTerminals) {
      ptyService.killTerminal(terminalId);
    }
    socketTerminals.clear();
  });
});

// ---- Helper: Build callbacks that emit to Socket.IO room ----
// CRITICAL: All emissions MUST use io.to(sessionId).emit() (room-based, not socket-based)
// This ensures events continue to flow even after socket disconnects/reconnects
// The session room persists across socket instances for the same browser tab

function buildSocketCallbacks(sessionId: string, projectPath?: string) {
  return {
    onText: (text: string, messageIndex: number) => {
      const payload = { session_id: sessionId, text, message_index: messageIndex };
      const event = eventLog.append(sessionId, 'text_delta', payload);
      io.to(sessionId).emit("text_delta", { ...payload, seq: event.seq });
    },
    onToolEvent: (event: Record<string, unknown>) => {
      const payload = { ...event, session_id: sessionId };
      const logEvent = eventLog.append(sessionId, 'tool_event', payload);
      io.to(sessionId).emit("tool_event", { ...payload, seq: logEvent.seq });
      // Count lines of code
      if (event.type === "tool_complete" && (event.tool_name === "Write" || event.tool_name === "Edit")) {
        const params = event.parameters as Record<string, unknown> | undefined;
        const content = (params?.content as string) ?? (params?.new_string as string) ?? "";
        if (content) {
          const lines = content.split("\n").length;
          try {
            database.incrementUserStats("local", 0, 0, 0, 0, 0, 0, lines);
          } catch (e) {
            log.error("Failed to increment LOC", { sessionId, error: String(e) });
          }
        }
      }
    },
    onComplete: (result: Record<string, unknown>) => {
      try {
        database.incrementUserStats(
          "local",
          0,
          1,
          (result.duration_ms as number) ?? 0,
          (result.cost as number) ?? 0,
          (result.input_tokens as number) ?? 0,
          (result.output_tokens as number) ?? 0,
        );
      } catch (e) {
        log.error("Failed to increment user stats", { sessionId, error: String(e) });
      }

      // Record per-query usage for insights dashboard
      try {
        database.recordQueryUsage({
          sessionId,
          inputTokens: (result.input_tokens as number) ?? 0,
          outputTokens: (result.output_tokens as number) ?? 0,
          cacheReadInputTokens: (result.cache_read_input_tokens as number) ?? 0,
          cacheCreationInputTokens: (result.cache_creation_input_tokens as number) ?? 0,
          costUsd: (result.cost as number) ?? 0,
          durationMs: (result.duration_ms as number) ?? 0,
          model: (result.model as string) ?? null,
          projectPath: projectPath ?? null,
        });
      } catch (e) {
        log.error("Failed to record query usage", { sessionId, error: String(e) });
      }

      // Persist session context for tab restoration
      try {
        database.updateSessionContext(
          sessionId,
          (result.input_tokens as number) ?? 0,
          (result.model as string) ?? null
        );
      } catch (e) {
        log.error("Failed to update session context", { sessionId, error: String(e) });
      }

      const payload = {
        cost: result.cost,
        duration_ms: result.duration_ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cache_read_input_tokens: result.cache_read_input_tokens,
        cache_creation_input_tokens: result.cache_creation_input_tokens,
        context_window_size: result.context_window_size,
        model: result.model,
        sdk_session_id: result.sdk_session_id,
        content: result.text,
        message_index: result.message_index,
        session_id: sessionId,
      };
      const event = eventLog.append(sessionId, 'response_complete', payload);
      io.to(sessionId).emit("response_complete", { ...payload, seq: event.seq });
    },
    onError: (message: string) => {
      const payload = { message, session_id: sessionId };
      const event = eventLog.append(sessionId, 'error', payload);
      io.to(sessionId).emit("error", { ...payload, seq: event.seq });
    },
    onUserQuestion: (data: Record<string, unknown>) => {
      const payload = {
        questions: data.questions ?? [],
        tool_use_id: data.tool_use_id ?? "",
        session_id: sessionId,
      };
      const event = eventLog.append(sessionId, 'user_question', payload);
      io.to(sessionId).emit("user_question", { ...payload, seq: event.seq });
    },
    onSignal: (signal: { type: string; data: Record<string, unknown> }) => {
      io.to(sessionId).emit("signal", signal);
    },
    onToolProgress: (data: { tool_use_id: string; elapsed_seconds: number }) => {
      const payload = { ...data, session_id: sessionId };
      const event = eventLog.append(sessionId, 'tool_progress', payload);
      io.to(sessionId).emit("tool_progress", { ...payload, seq: event.seq });
    },
    onRateLimit: (data: { retryAfterMs: number; rateLimitedAt: string }) => {
      const payload = { ...data, session_id: sessionId };
      const event = eventLog.append(sessionId, 'rate_limit', payload);
      io.to(sessionId).emit("rate_limit", { ...payload, seq: event.seq });
      try {
        database.recordRateLimitEvent(sessionId, data.retryAfterMs);
      } catch (err) {
        log.error('Failed to record rate limit event:', { error: String(err) });
      }
    },
    onPromptSuggestion: (suggestions: string[]) => {
      io.to(sessionId).emit("prompt_suggestions", { suggestions });
    },
    onCompactBoundary: () => {
      io.to(sessionId).emit("compact_boundary", { timestamp: new Date().toISOString() });
    },
    onDevServerDetected: (url: string) => {
      io.to(sessionId).emit("dev_server_detected", { url, session_id: sessionId });
    },
    onCaptureScreenshot: (): Promise<{ image?: string; url?: string; error?: string }> => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ error: "Screenshot timeout - no browser tab responded within 10 seconds" });
        }, 10000);

        // Set up one-time listener for screenshot result
        const handleScreenshotResult = (data: { image?: string; url?: string; error?: string; session_id?: string }) => {
          // Only handle responses for this session
          if (data.session_id === sessionId) {
            clearTimeout(timeout);
            io.off("screenshot_result", handleScreenshotResult);
            resolve(data);
          }
        };

        // Listen for screenshot result
        io.on("screenshot_result", handleScreenshotResult);

        // Request screenshot from frontend
        io.to(sessionId).emit("capture_screenshot", { session_id: sessionId });
      });
    },
    // Thinking deltas intentionally not emitted to frontend
  };
}

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

  // 4. Remove PID file
  removePidFile();

  // 5. Exit
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
          buildSocketCallbacks(sessionId, workspace),
          undefined,
          undefined,
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
});
