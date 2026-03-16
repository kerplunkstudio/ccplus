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
import * as auth from "./auth.js";
import * as database from "./database.js";
import * as sdkSession from "./sdk-session.js";
import { findClaudeBinary } from "./utils.js";

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
  console.log(`Marked ${orphanCount} orphaned tool events from previous run`);
}

// Maps socket.id -> { session_id, user_id }
const connectedClients = new Map<string, { session_id: string; user_id: string }>();

// Track mutable workspace path
let workspacePath = config.WORKSPACE_PATH;

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
    db: dbStats,
  });
});

// -- Auth --

app.post("/api/auth/auto-login", (_req: Request, res: Response) => {
  if (!config.LOCAL_MODE) {
    res.status(403).json({ error: "Auto-login disabled in production mode" });
    return;
  }
  const token = auth.autoLogin();
  if (!token) {
    res.status(500).json({ error: "Failed to generate token" });
    return;
  }
  res.json({ token, user: { id: "local", username: "local" } });
});

app.post("/api/auth/verify", (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  const userId = auth.verifyToken(token ?? "");
  if (!userId) {
    res.status(401).json({ valid: false });
    return;
  }
  res.json({ valid: true, user: { id: userId, username: userId } });
});

// -- Version --

app.get("/api/version", (_req: Request, res: Response) => {
  let gitSha: string | null = null;
  try {
    gitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      timeout: 2000,
      cwd: config.PROJECT_ROOT,
      encoding: "utf-8",
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
    });

    if (config.CCPLUS_CHANNEL === "stable") {
      const tags = execFileSync("git", ["tag", "--sort=-v:refname"], {
        timeout: 2000,
        cwd: config.PROJECT_ROOT,
        encoding: "utf-8",
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

app.get("/api/status/first-run", (req: Request, res: Response) => {
  const token = (req.headers.authorization ?? "").replace("Bearer ", "");
  if (!auth.verifyToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ first_run: database.isFirstRun() });
});

// -- Data --

app.get("/api/history/:sessionId", (req: Request, res: Response) => {
  try {
    const messages = database.getConversationHistory(req.params.sessionId);
    const context = database.getSessionContext(req.params.sessionId);
    res.json({
      messages,
      streaming: sdkSession.isActive(req.params.sessionId),
      context_tokens: context?.input_tokens ?? null,
      model: context?.model ?? null,
    });
  } catch (err) {
    console.error("Failed to fetch history:", err);
    res.status(500).json({ error: "Failed to load history" });
  }
});

app.get("/api/activity/:sessionId", (req: Request, res: Response) => {
  try {
    const events = database.getToolEvents(req.params.sessionId);
    res.json({ events });
  } catch (err) {
    console.error("Failed to fetch activity:", err);
    res.status(500).json({ error: "Failed to load activity" });
  }
});

app.get("/api/stats", (_req: Request, res: Response) => {
  try {
    res.json(database.getStats());
  } catch (err) {
    console.error("Failed to fetch stats:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

app.get("/api/stats/user", (_req: Request, res: Response) => {
  try {
    res.json(database.getUserStats("local"));
  } catch (err) {
    console.error("Failed to fetch user stats:", err);
    res.status(500).json({ error: "Failed to load user stats" });
  }
});

app.get("/api/insights", (req: Request, res: Response) => {
  try {
    let days = parseInt(req.query.days as string ?? "30", 10);
    if (isNaN(days) || days < 1 || days > 365) days = 30;
    const project = (req.query.project as string) || undefined;
    res.json(database.getInsights(days, project));
  } catch (err) {
    console.error("Failed to fetch insights:", err);
    res.status(500).json({ error: "Failed to load insights" });
  }
});

// -- Projects --

app.get("/api/projects", (_req: Request, res: Response) => {
  try {
    const ws = path.resolve(workspacePath);
    const projects: { name: string; path: string }[] = [];
    for (const name of readdirSync(ws).sort()) {
      const fullPath = path.join(ws, name);
      if (!name.startsWith(".") && statSync(fullPath).isDirectory()) {
        projects.push({ name, path: fullPath });
      }
    }
    res.json({ projects, workspace: workspacePath });
  } catch (err) {
    console.error("Failed to list projects:", err);
    res.status(500).json({ error: "Failed to list projects" });
  }
});

app.post("/api/projects/clone", (req: Request, res: Response) => {
  const { url } = req.body ?? {};
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
  const targetPath = path.join(path.resolve(workspacePath), repoName);

  if (existsSync(targetPath)) {
    res.status(409).json({ error: `Directory '${repoName}' already exists in workspace` });
    return;
  }

  try {
    execFileSync("git", ["clone", repoUrl, targetPath], { timeout: 300_000 });
    res.json({ name: repoName, path: targetPath });
  } catch (err) {
    console.error("Git clone failed:", err);
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
  const { path: newPath } = req.body ?? {};
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

  workspacePath = resolved;
  process.env.WORKSPACE_PATH = resolved;
  res.json({ workspace: resolved });
});

// -- Git context --

app.get("/api/git/context", (req: Request, res: Response) => {
  const projectPath = (req.query.project as string ?? "").trim();
  if (!projectPath) {
    res.status(400).json({ error: "project parameter required" });
    return;
  }

  const projectDir = path.resolve(projectPath);
  const wsDir = path.resolve(workspacePath);
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
      timeout: 5000, encoding: "utf-8",
    }).trim();
  } catch {
    result.branch = null;
  }

  try {
    const status = execFileSync("git", ["-C", projectDir, "status", "--porcelain"], {
      timeout: 5000, encoding: "utf-8",
    }).trim();
    result.dirty_count = status ? status.split("\n").filter(Boolean).length : 0;
  } catch {
    result.dirty_count = 0;
  }

  try {
    const log = execFileSync("git", ["-C", projectDir, "log", "--format=%H|||%h|||%s|||%ar", "-n", "5"], {
      timeout: 5000, encoding: "utf-8",
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
    console.error("Failed to list sessions:", err);
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
    console.error("Failed to archive session:", err);
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
    console.error("Failed to store image:", err);
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
    console.error("Failed to retrieve image:", err);
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

  const projectDir = path.resolve(projectPath);
  const wsDir = path.resolve(workspacePath);
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
      timeout: 5000, encoding: "utf-8",
    }).trim();
    const status = execFileSync("git", ["-C", projectDir, "status", "--porcelain"], {
      timeout: 5000, encoding: "utf-8",
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
      timeout: 5000, encoding: "utf-8",
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

// =========================================================================
// WebSocket Events
// =========================================================================

io.on("connection", (socket) => {
  const token = socket.handshake.auth.token as string ?? "";
  const userId = auth.verifyToken(token);

  if (!userId) {
    console.warn("WebSocket connection rejected: invalid token");
    socket.disconnect(true);
    return;
  }

  const sessionId = (socket.handshake.auth.session_id as string) ?? socket.id;

  connectedClients.set(socket.id, { session_id: sessionId, user_id: userId });
  socket.join(sessionId);

  // Check if session has active query — re-register callbacks
  if (sdkSession.isActive(sessionId)) {
    sdkSession.registerCallbacks(sessionId, buildSocketCallbacks(sessionId, userId));
    io.to(sessionId).emit("stream_active", {});

    // Send accumulated streaming content so client can catch up on missed deltas
    const bufferedContent = sdkSession.getStreamingContent(sessionId);
    if (bufferedContent) {
      io.to(sessionId).emit("stream_content_sync", { content: bufferedContent });
    }

    const pq = sdkSession.getPendingQuestion(sessionId);
    if (pq) {
      io.to(sessionId).emit("user_question", {
        questions: pq.questions ?? [],
        tool_use_id: pq.tool_use_id ?? "",
      });
    }
  } else {
    // Session not active - check if there's a missed response_complete
    const missedResponse = sdkSession.getLastCompletedResponse(sessionId);
    if (missedResponse) {
      io.to(sessionId).emit("response_complete", {
        cost: missedResponse.cost,
        duration_ms: missedResponse.duration_ms,
        input_tokens: missedResponse.input_tokens,
        output_tokens: missedResponse.output_tokens,
        model: missedResponse.model,
        sdk_session_id: missedResponse.sdk_session_id,
        content: missedResponse.text,
      });
    }
  }

  socket.emit("connected", { session_id: sessionId });

  // -- Message handler --

  socket.on("message", (data: Record<string, unknown>) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      socket.emit("error", { message: "Not authenticated" });
      return;
    }

    const sid = client.session_id;
    const uid = client.user_id;
    const content = ((data?.content as string) ?? "").trim();
    const workspace = (data?.workspace as string) ?? workspacePath;
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
          console.error("Failed to increment session count:", e);
        }
      }
    } catch (err) {
      console.error("Failed to record user message:", err);
    }

    socket.emit("message_received", { status: "ok" });

    // Submit to SDK
    sdkSession.submitQuery(
      sid,
      content || "[Image attached]",
      workspace,
      buildSocketCallbacks(sid, uid),
      model,
      imageIdsData.length ? imageIdsData : undefined,
    );
  });

  // -- Cancel --

  socket.on("cancel", () => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    sdkSession.cancelQuery(client.session_id);
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
    const response = (data?.response as Record<string, unknown>) ?? {};
    sdkSession.sendQuestionResponse(client.session_id, response);
  });

  // -- Duplicate session --

  socket.on("duplicate_session", (data: { sourceSessionId: string; newSessionId: string }, callback?: (response: { success: boolean; error?: string; conversations?: number; toolEvents?: number; images?: number }) => void) => {
    const client = connectedClients.get(socket.id);
    if (!client) {
      callback?.({ success: false, error: "Not authenticated" });
      return;
    }

    try {
      const result = database.duplicateSession(data.sourceSessionId, data.newSessionId, client.user_id);
      callback?.({ success: true, conversations: result.conversations, toolEvents: result.toolEvents, images: result.images });
    } catch (err) {
      console.error("Failed to duplicate session:", err);
      callback?.({ success: false, error: String(err) });
    }
  });

  // -- Disconnect --

  socket.on("disconnect", () => {
    const client = connectedClients.get(socket.id);
    connectedClients.delete(socket.id);
    if (client) {
      console.log(`Client disconnected: user=${client.user_id} session=${client.session_id}`);
    }
  });
});

// ---- Helper: Build callbacks that emit to Socket.IO room ----

function buildSocketCallbacks(sessionId: string, userId: string) {
  return {
    onText: (text: string) => {
      io.to(sessionId).emit("text_delta", { text });
    },
    onToolEvent: (event: Record<string, unknown>) => {
      io.to(sessionId).emit("tool_event", event);
      // Count lines of code
      if (event.type === "tool_complete" && (event.tool_name === "Write" || event.tool_name === "Edit")) {
        const params = event.parameters as Record<string, unknown> | undefined;
        const content = (params?.content as string) ?? (params?.new_string as string) ?? "";
        if (content) {
          const lines = content.split("\n").length;
          try {
            database.incrementUserStats(userId, 0, 0, 0, 0, 0, 0, lines);
          } catch (e) {
            console.error("Failed to increment LOC:", e);
          }
        }
      }
    },
    onComplete: (result: Record<string, unknown>) => {
      try {
        database.incrementUserStats(
          userId,
          0,
          1,
          (result.duration_ms as number) ?? 0,
          (result.cost as number) ?? 0,
          (result.input_tokens as number) ?? 0,
          (result.output_tokens as number) ?? 0,
        );
      } catch (e) {
        console.error("Failed to increment user stats:", e);
      }

      // Persist session context for tab restoration
      try {
        database.updateSessionContext(
          sessionId,
          (result.input_tokens as number) ?? 0,
          (result.model as string) ?? null
        );
      } catch (e) {
        console.error("Failed to update session context:", e);
      }

      io.to(sessionId).emit("response_complete", {
        cost: result.cost,
        duration_ms: result.duration_ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        model: result.model,
        sdk_session_id: result.sdk_session_id,
        content: result.text,
      });
    },
    onError: (message: string) => {
      io.to(sessionId).emit("error", { message });
    },
    onUserQuestion: (data: Record<string, unknown>) => {
      io.to(sessionId).emit("user_question", {
        questions: data.questions ?? [],
        tool_use_id: data.tool_use_id ?? "",
      });
    },
    onSignal: (signal: { type: string; data: Record<string, unknown> }) => {
      io.to(sessionId).emit("signal", signal);
    },
    onToolProgress: (data: { tool_use_id: string; elapsed_seconds: number }) => {
      io.to(sessionId).emit("tool_progress", data);
    },
    onRateLimit: (data: { retryAfterMs: number; rateLimitedAt: string }) => {
      io.to(sessionId).emit("rate_limit", data);
    },
    onPromptSuggestion: (suggestions: string[]) => {
      io.to(sessionId).emit("prompt_suggestions", { suggestions });
    },
    onCompactBoundary: () => {
      io.to(sessionId).emit("compact_boundary", { timestamp: new Date().toISOString() });
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
    console.error("Failed to write PID file:", e);
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
console.log(`Starting ccplus server on ${config.HOST}:${config.PORT}`);
console.log(`Local mode: ${config.LOCAL_MODE}`);
console.log(`Workspace: ${workspacePath}`);
console.log(`Database: ${config.DATABASE_PATH}`);
console.log(`Static dir: ${config.STATIC_DIR}`);

writePidFile();
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  removePidFile();
  process.exit(0);
});
process.on("exit", removePidFile);

httpServer.listen(config.PORT, config.HOST, () => {
  console.log(`ccplus server listening on http://${config.HOST}:${config.PORT}`);
});
