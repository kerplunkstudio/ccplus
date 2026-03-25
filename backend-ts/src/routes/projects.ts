import type { Express, Request, Response } from "express";
import { execFileSync } from "child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import path from "path";
import process from "process";
import { homedir } from "os";
import { log } from "../logger.js";
import type { RouteDependencies } from "./types.js";

export function createProjectRoutes(app: Express, deps: RouteDependencies): void {
  const { database, getWorkspaceForSession } = deps;
  if (!database || !getWorkspaceForSession) throw new Error("Missing required dependencies");

  app.get("/api/projects", (req: Request, res: Response) => {
    try {
      const sessionId = (req.query.session_id as string) || undefined;
      const workspaceForSession = getWorkspaceForSession(sessionId);
      const ws = path.resolve(workspaceForSession);
      const projects = readdirSync(ws)
        .sort()
        .filter((name) => !name.startsWith("."))
        .map((name) => {
          const fullPath = path.join(ws, name);
          return statSync(fullPath).isDirectory() ? { name, path: fullPath } : null;
        })
        .filter((project): project is { name: string; path: string } => project !== null);
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

  app.get("/api/scan-projects", (_req: Request, res: Response) => {
    const home = homedir();
    const commonLocations = [
      "Workspace", "Projects", "Developer", "Code", "repos", "Documents/GitHub", "src",
    ].map((d) => path.join(home, d));

    let detectedProjects: { name: string; path: string }[] = [];
    const maxResults = 50;

    function scanDir(dir: string, depth: number, currentProjects: { name: string; path: string }[]): { name: string; path: string }[] {
      if (currentProjects.length >= maxResults || depth > 2) return currentProjects;
      try {
        const names = readdirSync(dir);
        let projects = currentProjects;

        for (const name of names) {
          if (projects.length >= maxResults) break;
          if (name.startsWith(".")) continue;
          const fullPath = path.join(dir, name);
          try {
            if (!statSync(fullPath).isDirectory()) continue;
          } catch {
            continue;
          }
          if (existsSync(path.join(fullPath, ".git"))) {
            projects = [...projects, { name, path: fullPath }];
            continue;
          }
          projects = scanDir(fullPath, depth + 1, projects);
        }
        return projects;
      } catch {
        // skip inaccessible dirs
        return currentProjects;
      }
    }

    for (const loc of commonLocations) {
      if (detectedProjects.length >= maxResults) break;
      if (existsSync(loc) && statSync(loc).isDirectory()) {
        detectedProjects = scanDir(loc, 0, detectedProjects);
      }
    }

    res.json({ projects: detectedProjects });
  });

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
      const entries = readdirSync(projectDir)
        .filter((n) => !n.startsWith(".") && !ignorePatterns.has(n))
        .sort((a, b) => {
          const aDir = statSync(path.join(projectDir, a)).isDirectory();
          const bDir = statSync(path.join(projectDir, b)).isDirectory();
          if (aDir !== bDir) return aDir ? -1 : 1;
          return a.localeCompare(b);
        })
        .slice(0, 30)
        .map((name) => {
          const isDir = statSync(path.join(projectDir, name)).isDirectory();
          return name + (isDir ? "/" : "");
        });
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
    let techStack: string[] = [];
    const pkgJsonPath = path.join(projectDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const pkgTech = [
          "react" in deps ? "React" : null,
          "vue" in deps ? "Vue" : null,
          "next" in deps ? "Next.js" : null,
          "express" in deps ? "Express" : null,
          ("typescript" in deps || existsSync(path.join(projectDir, "tsconfig.json"))) ? "TypeScript" : null,
        ].filter((tech): tech is string => tech !== null);
        techStack = [...techStack, ...pkgTech];
      } catch {
        // ignore
      }
    }
    const additionalTech = [
      (existsSync(path.join(projectDir, "requirements.txt")) || existsSync(path.join(projectDir, "pyproject.toml"))) ? "Python" : null,
      existsSync(path.join(projectDir, "Cargo.toml")) ? "Rust" : null,
      existsSync(path.join(projectDir, "go.mod")) ? "Go" : null,
      existsSync(path.join(projectDir, "Dockerfile")) ? "Docker" : null,
    ].filter((tech): tech is string => tech !== null);
    techStack = [...techStack, ...additionalTech];
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
}
