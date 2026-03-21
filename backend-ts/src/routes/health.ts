import type { Express, Request, Response } from "express";
import { execFileSync } from "child_process";
import * as config from "../config.js";

export function createHealthRoutes(
  app: Express,
  deps: {
    database: any;
    sdkSession: any;
    connectedClients: Map<string, { session_id: string; sessions: Set<string> }>;
    START_TIME: number;
  }
): void {
  const { database, sdkSession, connectedClients, START_TIME } = deps;

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

  app.get("/api/status/first-run", (_req: Request, res: Response) => {
    res.json({ first_run: database.isFirstRun() });
  });
}
