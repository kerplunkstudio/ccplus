import { existsSync, statSync } from "fs";
import { execSync } from "child_process";
import * as config from "./config.js";
import Database from "better-sqlite3";
import path from "path";

export interface CheckResult {
  status: "ok" | "warning" | "error";
  message: string;
}

/**
 * Check server health by querying the /health endpoint
 */
export async function checkServerHealth(port: number): Promise<CheckResult> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    if (response.ok) {
      const data = await response.json() as { connected_clients?: number };
      const clients = data.connected_clients ?? 0;
      return {
        status: "ok",
        message: `Server is healthy (${clients} active connection${clients === 1 ? "" : "s"})`,
      };
    } else {
      return {
        status: "warning",
        message: `Server responded with status ${response.status}`,
      };
    }
  } catch (error) {
    return {
      status: "warning",
      message: "Server not responding",
    };
  }
}

/**
 * Check database integrity using SQLite's PRAGMA integrity_check
 */
export function checkDatabaseIntegrity(dbPath: string): CheckResult {
  if (!existsSync(dbPath)) {
    return {
      status: "warning",
      message: "Database not found (will be created on first run)",
    };
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    // Use exec to run PRAGMA integrity_check and get raw result
    const stmt = db.prepare("PRAGMA integrity_check");
    const result = stmt.all() as Array<{ integrity_check: string }>;
    db.close();

    if (result.length === 1 && result[0].integrity_check === "ok") {
      return {
        status: "ok",
        message: "Database integrity OK",
      };
    } else {
      const messages = result.map((r) => r.integrity_check);
      return {
        status: "error",
        message: `Database integrity check failed: ${messages.join(", ")}`,
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: `Database integrity check error: ${String(error)}`,
    };
  }
}

/**
 * Check required and optional environment variables
 */
export function checkConfig(): CheckResult[] {
  const results: CheckResult[] = [];

  // Required vars (with defaults in config.ts, but we check if they're reasonable)
  if (!config.WORKSPACE_PATH || !existsSync(config.WORKSPACE_PATH)) {
    results.push({
      status: "warning",
      message: `WORKSPACE_PATH is not set or does not exist: ${config.WORKSPACE_PATH}`,
    });
  } else {
    results.push({
      status: "ok",
      message: `WORKSPACE_PATH: ${config.WORKSPACE_PATH}`,
    });
  }

  // Check SECRET_KEY security
  if (config.SECRET_KEY === "ccplus-dev-secret-change-me" && !config.LOCAL_MODE) {
    results.push({
      status: "error",
      message: "SECRET_KEY is insecure default in non-local mode",
    });
  } else if (config.SECRET_KEY === "ccplus-dev-secret-change-me") {
    results.push({
      status: "warning",
      message: "SECRET_KEY is insecure default (OK for local dev)",
    });
  } else {
    results.push({
      status: "ok",
      message: "SECRET_KEY is configured",
    });
  }

  // Check SDK_MODEL
  const validModels = ["sonnet", "opus", "haiku"];
  if (!validModels.includes(config.SDK_MODEL)) {
    results.push({
      status: "warning",
      message: `SDK_MODEL is "${config.SDK_MODEL}" (expected: sonnet, opus, or haiku)`,
    });
  } else {
    results.push({
      status: "ok",
      message: `SDK_MODEL: ${config.SDK_MODEL}`,
    });
  }

  return results;
}

/**
 * Check available disk space in the data directory
 */
export function checkDiskSpace(dataDir: string): CheckResult {
  if (!existsSync(dataDir)) {
    return {
      status: "warning",
      message: `Data directory does not exist: ${dataDir}`,
    };
  }

  try {
    // Use `df` command to get disk space (works on macOS and Linux)
    const output = execSync(`df -k "${dataDir}"`, { encoding: "utf-8" });
    const lines = output.trim().split("\n");

    if (lines.length < 2) {
      return {
        status: "warning",
        message: "Could not determine disk space",
      };
    }

    // Parse the second line (data row)
    const parts = lines[1].split(/\s+/);
    const availableKB = parseInt(parts[3], 10);
    const availableMB = Math.round(availableKB / 1024);
    const availableGB = availableMB / 1024;

    if (availableMB < 1024) {
      return {
        status: "warning",
        message: `Low disk space: ${availableMB}MB available in ${dataDir}`,
      };
    } else {
      return {
        status: "ok",
        message: `Disk space: ${availableGB.toFixed(1)}GB available`,
      };
    }
  } catch (error) {
    return {
      status: "warning",
      message: `Could not check disk space: ${String(error)}`,
    };
  }
}

/**
 * Check log file sizes
 */
export function checkLogSize(logDir: string): CheckResult[] {
  const results: CheckResult[] = [];
  const maxLogSizeMB = 100;

  if (!existsSync(logDir)) {
    return [{
      status: "ok",
      message: "Log directory does not exist yet",
    }];
  }

  try {
    const serverLogPath = path.join(logDir, "server.log");

    if (existsSync(serverLogPath)) {
      const stats = statSync(serverLogPath);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB > maxLogSizeMB) {
        results.push({
          status: "warning",
          message: `server.log is ${sizeMB.toFixed(1)}MB (consider rotation)`,
        });
      } else {
        results.push({
          status: "ok",
          message: `server.log size: ${sizeMB.toFixed(1)}MB`,
        });
      }
    } else {
      results.push({
        status: "ok",
        message: "server.log does not exist yet",
      });
    }
  } catch (error) {
    results.push({
      status: "warning",
      message: `Could not check log size: ${String(error)}`,
    });
  }

  return results;
}

/**
 * Check if the configured port is available
 */
export function checkPortAvailability(port: number): CheckResult {
  try {
    // Use lsof to check if port is in use
    const output = execSync(`lsof -ti:${port}`, { encoding: "utf-8", stdio: "pipe" });
    const pids = output.trim().split("\n").filter((p) => p);

    if (pids.length > 0) {
      return {
        status: "ok",
        message: `Port ${port} is in use (server likely running, PID: ${pids[0]})`,
      };
    } else {
      return {
        status: "warning",
        message: `Port ${port} is free (server not running)`,
      };
    }
  } catch (error) {
    // lsof returns non-zero exit code when port is free
    return {
      status: "warning",
      message: `Port ${port} is free (server not running)`,
    };
  }
}

/**
 * Check if node_modules are stale compared to package-lock.json
 */
export function checkNodeModulesFreshness(projectRoot: string): CheckResult[] {
  const results: CheckResult[] = [];

  // Check backend
  const backendDir = path.join(projectRoot, "backend-ts");
  const backendLock = path.join(backendDir, "package-lock.json");
  const backendModules = path.join(backendDir, "node_modules");

  if (existsSync(backendLock) && existsSync(backendModules)) {
    const lockMtime = statSync(backendLock).mtimeMs;
    const modulesMtime = statSync(backendModules).mtimeMs;

    if (lockMtime > modulesMtime) {
      results.push({
        status: "warning",
        message: "backend-ts/node_modules may be stale (package-lock.json is newer)",
      });
    } else {
      results.push({
        status: "ok",
        message: "backend-ts/node_modules is up to date",
      });
    }
  } else if (!existsSync(backendModules)) {
    results.push({
      status: "error",
      message: "backend-ts/node_modules not found",
    });
  } else {
    results.push({
      status: "ok",
      message: "backend-ts/node_modules exists",
    });
  }

  // Check frontend
  const frontendDir = path.join(projectRoot, "frontend");
  const frontendLock = path.join(frontendDir, "package-lock.json");
  const frontendModules = path.join(frontendDir, "node_modules");

  if (existsSync(frontendLock) && existsSync(frontendModules)) {
    const lockMtime = statSync(frontendLock).mtimeMs;
    const modulesMtime = statSync(frontendModules).mtimeMs;

    if (lockMtime > modulesMtime) {
      results.push({
        status: "warning",
        message: "frontend/node_modules may be stale (package-lock.json is newer)",
      });
    } else {
      results.push({
        status: "ok",
        message: "frontend/node_modules is up to date",
      });
    }
  } else if (!existsSync(frontendModules)) {
    results.push({
      status: "error",
      message: "frontend/node_modules not found",
    });
  } else {
    results.push({
      status: "ok",
      message: "frontend/node_modules exists",
    });
  }

  return results;
}

/**
 * Check connection health by querying the /api/health/connections endpoint
 */
export async function checkConnectionHealth(port: number): Promise<CheckResult[]> {
  try {
    const response = await fetch(`http://localhost:${port}/api/health/connections`);
    if (!response.ok) {
      return [{
        status: "warning",
        message: "Connection health endpoint not available",
      }];
    }

    const data = await response.json() as {
      total_connections?: number;
      stale_count?: number;
      rate_limited?: number;
    };

    const results: CheckResult[] = [];

    if (data.total_connections !== undefined) {
      results.push({
        status: "ok",
        message: `Total connections: ${data.total_connections}`,
      });
    }

    if (data.stale_count !== undefined && data.stale_count > 0) {
      results.push({
        status: "warning",
        message: `Stale connections detected: ${data.stale_count}`,
      });
    }

    if (data.rate_limited !== undefined && data.rate_limited > 0) {
      results.push({
        status: "warning",
        message: `Rate-limited connections: ${data.rate_limited}`,
      });
    }

    return results.length > 0 ? results : [{
      status: "ok",
      message: "Connection health data available",
    }];
  } catch (error) {
    return [{
      status: "warning",
      message: "Connection health not available",
    }];
  }
}

/**
 * Check recent errors in tool_usage table
 */
export function checkRecentErrors(dbPath: string): CheckResult[] {
  if (!existsSync(dbPath)) {
    return [{
      status: "warning",
      message: "Database not found (no error data available)",
    }];
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const stmt = db.prepare(`
      SELECT tool_name, error, COUNT(*) as count
      FROM tool_usage
      WHERE success = 0 AND error IS NOT NULL
        AND timestamp >= datetime('now', '-1 day', 'localtime')
      GROUP BY tool_name, error
      ORDER BY count DESC
      LIMIT 5
    `);
    const errors = stmt.all() as Array<{ tool_name: string; error: string; count: number }>;
    db.close();

    if (errors.length === 0) {
      return [{
        status: "ok",
        message: "No errors in the last 24 hours",
      }];
    }

    const results: CheckResult[] = [{
      status: "warning",
      message: `Found ${errors.length} error type(s) in last 24 hours`,
    }];

    // Add top error summary
    const topError = errors[0];
    results.push({
      status: "warning",
      message: `Most frequent: ${topError.tool_name} - ${topError.error.substring(0, 60)} (${topError.count}x)`,
    });

    return results;
  } catch (error) {
    return [{
      status: "warning",
      message: `Could not check recent errors: ${String(error)}`,
    }];
  }
}

/**
 * Check transcript_events table statistics
 */
export function checkTranscriptStats(dbPath: string): CheckResult[] {
  if (!existsSync(dbPath)) {
    return [{
      status: "warning",
      message: "Database not found (no transcript data available)",
    }];
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Check if transcript_events table exists
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='transcript_events'"
    ).get() as { name: string } | undefined;

    if (!tableCheck) {
      db.close();
      return [{
        status: "ok",
        message: "Transcript events table not yet created",
      }];
    }

    // Get total count
    const totalStmt = db.prepare("SELECT COUNT(*) as count FROM transcript_events");
    const totalResult = totalStmt.get() as { count: number };

    // Get count in last 24h
    const recentStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM transcript_events
      WHERE timestamp >= datetime('now', '-1 day', 'localtime')
    `);
    const recentResult = recentStmt.get() as { count: number };

    // Get breakdown by event_type in last 24h
    const breakdownStmt = db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM transcript_events
      WHERE timestamp >= datetime('now', '-1 day', 'localtime')
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT 5
    `);
    const breakdown = breakdownStmt.all() as Array<{ event_type: string; count: number }>;

    db.close();

    const results: CheckResult[] = [{
      status: "ok",
      message: `Total transcript events: ${totalResult.count} (${recentResult.count} in last 24h)`,
    }];

    if (breakdown.length > 0) {
      const topTypes = breakdown.map((b) => `${b.event_type}: ${b.count}`).join(", ");
      results.push({
        status: "ok",
        message: `Event types (24h): ${topTypes}`,
      });
    }

    return results;
  } catch (error) {
    return [{
      status: "warning",
      message: `Could not check transcript stats: ${String(error)}`,
    }];
  }
}

/**
 * Check database file size
 */
export function checkDatabaseSize(dbPath: string): CheckResult {
  if (!existsSync(dbPath)) {
    return {
      status: "warning",
      message: "Database not found (will be created on first run)",
    };
  }

  try {
    const stats = statSync(dbPath);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB > 1024) {
      return {
        status: "error",
        message: `Database is ${sizeMB.toFixed(1)}MB (> 1GB threshold)`,
      };
    } else if (sizeMB > 500) {
      return {
        status: "warning",
        message: `Database is ${sizeMB.toFixed(1)}MB (> 500MB threshold)`,
      };
    } else {
      return {
        status: "ok",
        message: `Database size: ${sizeMB.toFixed(1)}MB`,
      };
    }
  } catch (error) {
    return {
      status: "warning",
      message: `Could not check database size: ${String(error)}`,
    };
  }
}

/**
 * Check if .env file exists and report its modification time
 */
export function checkConfigWatcher(envPath: string): CheckResult {
  if (!existsSync(envPath)) {
    return {
      status: "warning",
      message: ".env file not found (config may not be loaded)",
    };
  }

  try {
    const stats = statSync(envPath);
    const mtime = new Date(stats.mtime);
    const now = new Date();
    const ageMs = now.getTime() - mtime.getTime();
    const ageMinutes = Math.floor(ageMs / 60000);

    if (ageMinutes < 60) {
      return {
        status: "ok",
        message: `.env last modified ${ageMinutes} minute(s) ago`,
      };
    } else {
      const ageHours = Math.floor(ageMinutes / 60);
      return {
        status: "ok",
        message: `.env last modified ${ageHours} hour(s) ago`,
      };
    }
  } catch (error) {
    return {
      status: "warning",
      message: `Could not check .env file: ${String(error)}`,
    };
  }
}

/**
 * Format a CheckResult for display
 */
export function formatCheckResult(result: CheckResult): string {
  const icon = result.status === "ok" ? "✓" : result.status === "warning" ? "⚠" : "✗";
  return `${icon} ${result.message}`;
}
