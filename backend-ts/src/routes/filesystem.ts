import type { Express, Request, Response } from "express";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { homedir } from "os";

export function createFilesystemRoutes(app: Express): void {
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
}
