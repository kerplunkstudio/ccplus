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
 * Format a CheckResult for display
 */
export function formatCheckResult(result: CheckResult): string {
  const icon = result.status === "ok" ? "✓" : result.status === "warning" ? "⚠" : "✗";
  return `${icon} ${result.message}`;
}
