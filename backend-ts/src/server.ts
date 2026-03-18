import express, { Request, Response } from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
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
import { ProvenanceTracker } from "./provenance.js";
import { configWatcher, type ConfigChange } from "./config-watcher.js";
import { ConnectionHealthMonitor } from "./connection-health.js";
import { getAllMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from "./mcp-config.js";

// Remove CLAUDECODE env var
delete process.env.CLAUDECODE;

/** Find the Claude CLI binary path (mirrors Python PluginManager._find_claude_binary). */
function findClaudeBinary(): string | null {
  const candidates = [
    path.join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const result = execFileSync("which", ["claude"], { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const p = result.trim();
    if (p) return p;
  } catch { /* not in PATH */ }
  return null;
}

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

// Provenance tracker for all connections
const provenanceTracker = new ProvenanceTracker();

// Connection health monitor
const connectionHealthMonitor = new ConnectionHealthMonitor();

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
  const healthStatus = connectionHealthMonitor.getHealthStatus();
  res.json({
    status: "ok",
    version: config.VERSION,
    channel: config.CCPLUS_CHANNEL,
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    active_sessions: sdkSession.getActiveSessions().length,
    connected_clients: connectedClients.size,
    stale_connections: healthStatus.stale,
    db: dbStats,
  });
});

app.get("/api/health/connections", (_req: Request, res: Response) => {
  const healthStatus = connectionHealthMonitor.getHealthStatus();
  const config = connectionHealthMonitor.getConfig();
  res.json({
    ...healthStatus,
    config: {
      stale_threshold_ms: config.staleThresholdMs,
      check_interval_ms: config.checkIntervalMs,
      max_reconnects_per_hour: config.maxReconnectsPerHour,
      grace_period_ms: config.gracePeriodMs,
    },
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
    res.json({ messages, streaming: sdkSession.isActive(req.params.sessionId) });
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
  if (!state) {
    res.status(400).json({ error: "No state provided" });
    return;
  }
  database.saveWorkspaceState("local", state);
  res.json({ status: "ok" });
});

app.post("/api/workspace", (req: Request, res: Response) => {
  // POST variant for sendBeacon during page unload
  const state = req.body;
  if (!state) {
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

// -- Connections (provenance) --

app.get("/api/connections", (_req: Request, res: Response) => {
  try {
    const connections = provenanceTracker.getAllConnections();
    res.json({ connections, total: connections.length });
  } catch (err) {
    console.error("Failed to fetch connections:", err);
    res.status(500).json({ error: "Failed to fetch connections" });
  }
});

app.get("/api/connections/:sessionId", (req: Request, res: Response) => {
  try {
    const connections = provenanceTracker.getActiveConnections(req.params.sessionId);
    res.json({ connections, session_id: req.params.sessionId });
  } catch (err) {
    console.error("Failed to fetch connections for session:", err);
    res.status(500).json({ error: "Failed to fetch connections for session" });
  }
});

// -- Connection health --

app.get("/api/health/connections", (_req: Request, res: Response) => {
  try {
    const healthStatus = connectionHealthMonitor.getHealthStatus();
    res.json(healthStatus);
  } catch (err) {
    console.error("Failed to fetch connection health:", err);
    res.status(500).json({ error: "Failed to fetch connection health" });
  }
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

// -- Transcript events --

app.get("/api/transcript/:sessionId", (req: Request, res: Response) => {
  try {
    const types = req.query.types ? (req.query.types as string).split(",") : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const events = database.getTranscript(req.params.sessionId, {
      eventTypes: types,
      limit,
      offset,
    });

    res.json({ events });
  } catch (err) {
    console.error("Failed to fetch transcript:", err);
    res.status(500).json({ error: "Failed to load transcript" });
  }
});

app.get("/api/transcript/:sessionId/export", (req: Request, res: Response) => {
  try {
    const events = database.exportTranscript(req.params.sessionId);
    res.json({ events, session_id: req.params.sessionId });
  } catch (err) {
    console.error("Failed to export transcript:", err);
    res.status(500).json({ error: "Failed to export transcript" });
  }
});

// -- MCP server management --

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

// =========================================================================
// WebSocket Events
// =========================================================================

io.on("connection", (socket) => {
  const token = socket.handshake.query.token as string ?? "";
  const userId = auth.verifyToken(token);

  if (!userId) {
    console.warn("WebSocket connection rejected: invalid token");
    socket.disconnect(true);
    return;
  }

  const sessionId = (socket.handshake.query.session_id as string) ?? socket.id;

  connectedClients.set(socket.id, { session_id: sessionId, user_id: userId });
  provenanceTracker.register(socket, sessionId);
  connectionHealthMonitor.onConnect(sessionId);
  socket.join(sessionId);

  // Track connection health
  connectionHealthMonitor.onConnect(sessionId);

  // Check if session has active query — re-register callbacks
  if (sdkSession.isActive(sessionId)) {
    const provenance = provenanceTracker.getProvenance(socket.id);
    sdkSession.registerCallbacks(sessionId, buildSocketCallbacks(sessionId, userId, provenance?.connectionId ?? undefined));
    io.to(sessionId).emit("stream_active", {});

    const pq = sdkSession.getPendingQuestion(sessionId);
    if (pq) {
      io.to(sessionId).emit("user_question", {
        questions: pq.questions ?? [],
        tool_use_id: pq.tool_use_id ?? "",
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

    connectionHealthMonitor.onEvent(client.session_id);




    const sid = client.session_id;
    const uid = client.user_id;
    const content = ((data?.content as string) ?? "").trim();
    const workspace = (data?.workspace as string) ?? workspacePath;
    const model = (data?.model as string) || undefined;
    const imageIdsData = (data?.image_ids as string[]) ?? [];
    const projectPathData = (data?.workspace as string) ?? "";

    if (!content && !imageIdsData.length) return;

    // Record user message with provenance
    try {
      const provenance = provenanceTracker.getProvenance(socket.id);
      const messageRecord = database.recordMessage(
        sid, uid, "user",
        content || "[Image]",
        undefined,
        projectPathData || undefined,
        imageIdsData.length ? imageIdsData : undefined,
        provenance?.connectionId ?? undefined,
        provenance?.sourceIp ?? undefined,
        provenance?.userAgent ?? undefined,
        undefined,
      );

      // Record transcript event
      database.recordTranscriptEvent({
        session_id: sid,
        event_type: "user_message",
        data: {
          content: content || "[Image]",
          role: "user",
          message_id: messageRecord.id,
          image_ids: imageIdsData.length ? imageIdsData : undefined,
        },
        metadata: {
          project_path: projectPathData || null,
        },
      });

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

    // Submit to SDK with provenance
    const provenance = provenanceTracker.getProvenance(socket.id);
    sdkSession.submitQuery(
      sid,
      content || "[Image attached]",
      workspace,
      buildSocketCallbacks(sid, uid, provenance?.connectionId ?? undefined),
      model,
      imageIdsData.length ? imageIdsData : undefined,
    );
  });

  // -- Cancel --

  socket.on("cancel", () => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    connectionHealthMonitor.onEvent(client.session_id);
    sdkSession.cancelQuery(client.session_id);

    // Record cancellation transcript event
    try {
      database.recordTranscriptEvent({
        session_id: client.session_id,
        event_type: "cancel",
        data: {
          cancelled_by: client.user_id,
        },
        metadata: null,
      });
    } catch (e) {
      console.error("Failed to record cancel transcript event:", e);
    }

    socket.emit("cancelled", { status: "ok" });
  });

  // -- Ping --

  socket.on("ping", () => {
    const client = connectedClients.get(socket.id);
    if (client) {
      connectionHealthMonitor.onEvent(client.session_id);
    }
    socket.emit("pong", { timestamp: Date.now() });
  });

  // -- Question response --

  socket.on("question_response", (data: Record<string, unknown>) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    connectionHealthMonitor.onEvent(client.session_id);
    const response = (data?.response as Record<string, unknown>) ?? {};
    sdkSession.sendQuestionResponse(client.session_id, response);
  });

  // -- Disconnect --

  socket.on("disconnect", () => {
    const client = connectedClients.get(socket.id);
    connectedClients.delete(socket.id);
    provenanceTracker.unregister(socket.id);
    if (client) {
      connectionHealthMonitor.onDisconnect(client.session_id);
      console.log(`Client disconnected: user=${client.user_id} session=${client.session_id}`);
    }
  });
});

// ---- Helper: Build callbacks that emit to Socket.IO room ----

function buildSocketCallbacks(sessionId: string, userId: string, sourceConnectionId?: string, correlationId?: string) {
  return {
    onText: (text: string) => {
      io.to(sessionId).emit("text_delta", { text });
    },
    onToolEvent: (event: Record<string, unknown>) => {
      io.to(sessionId).emit("tool_event", event);

      // Record transcript event for tool/agent lifecycle
      try {
        const eventType = event.type as string;
        if (eventType === "tool_start") {
          database.recordTranscriptEvent({
            session_id: sessionId,
            event_type: "tool_start",
            event_id: event.tool_use_id as string,
            parent_event_id: (event.parent_agent_id as string) ?? null,
            data: {
              tool_name: event.tool_name,
              parameters: event.parameters ?? {},
            },
            metadata: null,
          });
        } else if (eventType === "tool_complete") {
          database.recordTranscriptEvent({
            session_id: sessionId,
            event_type: "tool_complete",
            event_id: event.tool_use_id as string,
            parent_event_id: (event.parent_agent_id as string) ?? null,
            data: {
              tool_name: event.tool_name,
              success: event.success ?? false,
              error: event.error ?? null,
              duration_ms: event.duration_ms ?? null,
            },
            metadata: null,
          });
        } else if (eventType === "agent_start") {
          database.recordTranscriptEvent({
            session_id: sessionId,
            event_type: "agent_start",
            event_id: event.tool_use_id as string,
            parent_event_id: (event.parent_agent_id as string) ?? null,
            data: {
              agent_type: event.agent_type,
              description: event.description ?? "",
            },
            metadata: null,
          });
        } else if (eventType === "agent_stop") {
          database.recordTranscriptEvent({
            session_id: sessionId,
            event_type: "agent_stop",
            event_id: event.tool_use_id as string,
            parent_event_id: (event.parent_agent_id as string) ?? null,
            data: {
              agent_type: event.agent_type,
              success: event.success ?? false,
              error: event.error ?? null,
              duration_ms: event.duration_ms ?? null,
            },
            metadata: null,
          });
        }
      } catch (e) {
        console.error("Failed to record transcript event:", e);
      }

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
    sourceConnectionId,
    correlationId,
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

      // Record assistant message transcript event
      try {
        database.recordTranscriptEvent({
          session_id: sessionId,
          event_type: "assistant_message",
          data: {
            content: result.text ?? "",
            role: "assistant",
          },
          metadata: {
            cost: result.cost ?? null,
            duration_ms: result.duration_ms ?? null,
            input_tokens: result.input_tokens ?? null,
            output_tokens: result.output_tokens ?? null,
            model: result.model ?? null,
            sdk_session_id: result.sdk_session_id ?? null,
          },
        });
      } catch (e) {
        console.error("Failed to record assistant message transcript event:", e);
      }

      io.to(sessionId).emit("response_complete", {
        cost: result.cost,
        duration_ms: result.duration_ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        model: result.model,
        sdk_session_id: result.sdk_session_id,
        content: result.text,
        correlation_id: correlationId,
      });
    },
    onError: (message: string) => {
      io.to(sessionId).emit("error", { message });

      // Record error transcript event
      try {
        database.recordTranscriptEvent({
          session_id: sessionId,
          event_type: "error",
          data: {
            message,
          },
          metadata: null,
        });
      } catch (e) {
        console.error("Failed to record error transcript event:", e);
      }
    },
    onUserQuestion: (data: Record<string, unknown>) => {
      io.to(sessionId).emit("user_question", {
        questions: data.questions ?? [],
        tool_use_id: data.tool_use_id ?? "",
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

// Start connection health monitor
connectionHealthMonitor.start();
console.log(`Connection health monitor started`);

// Start config watcher
configWatcher.on('config:changed', (change: ConfigChange) => {
  if (change.hotReloadable) {
    console.log(`[config-watcher] Hot-reloaded ${change.key}: ${change.oldValue} -> ${change.newValue}`);
  } else {
    console.warn(`[config-watcher] Server restart required for ${change.key}: ${change.oldValue} -> ${change.newValue}`);
  }
});

configWatcher.start();
console.log(`Config watcher started`);

writePidFile();

// Shutdown handlers
process.on("SIGTERM", () => {
  console.log("SIGTERM received, cleaning up...");
  connectionHealthMonitor.stop();
  configWatcher.stop();
  removePidFile();
  database.closeDatabase();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, cleaning up...");
  connectionHealthMonitor.stop();
  configWatcher.stop();
  removePidFile();
  database.closeDatabase();
  process.exit(0);
});

httpServer.listen(config.PORT, config.HOST, () => {
  console.log(`ccplus server listening on http://${config.HOST}:${config.PORT}`);
});
