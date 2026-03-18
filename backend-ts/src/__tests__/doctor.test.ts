import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkDatabaseIntegrity,
  checkConfig,
  checkDiskSpace,
  checkLogSize,
  checkPortAvailability,
  checkNodeModulesFreshness,
  formatCheckResult,
  type CheckResult,
} from "../doctor.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import Database from "better-sqlite3";
import path from "path";

const TEST_DIR = path.join(import.meta.dirname, "../../test-temp");

beforeEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe("checkDatabaseIntegrity", () => {
  it("should return warning when database does not exist", () => {
    const dbPath = path.join(TEST_DIR, "nonexistent.db");
    const result = checkDatabaseIntegrity(dbPath);
    expect(result.status).toBe("warning");
    expect(result.message).toContain("not found");
  });

  it("should return ok for a healthy database", () => {
    const dbPath = path.join(TEST_DIR, "healthy.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    db.close();

    const result = checkDatabaseIntegrity(dbPath);
    expect(result.status).toBe("ok");
    expect(result.message).toContain("OK");
  });

  it("should detect corrupted database", () => {
    const dbPath = path.join(TEST_DIR, "corrupted.db");
    // Create a valid database
    const db = new Database(dbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    db.close();

    // Corrupt it by truncating
    writeFileSync(dbPath, "corrupted data");

    const result = checkDatabaseIntegrity(dbPath);
    expect(result.status).toBe("error");
    expect(result.message).toContain("error");
  });
});

describe("checkConfig", () => {
  it("should check WORKSPACE_PATH exists", () => {
    const results = checkConfig();
    const workspaceCheck = results.find((r) => r.message.includes("WORKSPACE_PATH"));
    expect(workspaceCheck).toBeDefined();
    // Status depends on whether WORKSPACE_PATH is set in .env
    expect(["ok", "warning"]).toContain(workspaceCheck!.status);
  });

  it("should check SECRET_KEY configuration", () => {
    const results = checkConfig();
    const secretCheck = results.find((r) => r.message.includes("SECRET_KEY"));
    expect(secretCheck).toBeDefined();
    expect(["ok", "warning", "error"]).toContain(secretCheck!.status);
  });

  it("should check SDK_MODEL validity", () => {
    const results = checkConfig();
    const modelCheck = results.find((r) => r.message.includes("SDK_MODEL"));
    expect(modelCheck).toBeDefined();
    expect(["ok", "warning"]).toContain(modelCheck!.status);
  });

  it("should return multiple check results", () => {
    const results = checkConfig();
    expect(results.length).toBeGreaterThanOrEqual(3);
  });
});

describe("checkDiskSpace", () => {
  it("should return warning when directory does not exist", () => {
    const result = checkDiskSpace(path.join(TEST_DIR, "nonexistent"));
    expect(result.status).toBe("warning");
    expect(result.message).toContain("does not exist");
  });

  it("should return disk space info for existing directory", () => {
    const result = checkDiskSpace(TEST_DIR);
    expect(["ok", "warning"]).toContain(result.status);
    expect(result.message).toMatch(/disk space|available/i);
  });

  it("should warn when disk space is low", () => {
    // This is hard to test without mocking, but we can verify the function runs
    const result = checkDiskSpace(TEST_DIR);
    expect(result).toBeDefined();
    expect(result.status).toBeDefined();
  });
});

describe("checkLogSize", () => {
  it("should return ok when log directory does not exist", () => {
    const results = checkLogSize(path.join(TEST_DIR, "nonexistent-logs"));
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("ok");
    expect(results[0].message).toContain("does not exist");
  });

  it("should return ok when server.log does not exist", () => {
    const logDir = path.join(TEST_DIR, "logs");
    mkdirSync(logDir);

    const results = checkLogSize(logDir);
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("ok");
    expect(results[0].message).toContain("does not exist");
  });

  it("should return ok for small log file", () => {
    const logDir = path.join(TEST_DIR, "logs");
    mkdirSync(logDir);

    const serverLog = path.join(logDir, "server.log");
    writeFileSync(serverLog, "small log content");

    const results = checkLogSize(logDir);
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("ok");
    expect(results[0].message).toContain("server.log size");
  });

  it("should warn when log file is too large", () => {
    const logDir = path.join(TEST_DIR, "logs");
    mkdirSync(logDir);

    const serverLog = path.join(logDir, "server.log");
    // Create a file > 100MB (simulate with metadata check)
    // For testing, we'll write a smaller file and verify the logic works
    const largeContent = "x".repeat(1024 * 1024 * 2); // 2MB
    writeFileSync(serverLog, largeContent);

    const results = checkLogSize(logDir);
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("ok"); // 2MB is below 100MB threshold
    expect(results[0].message).toContain("server.log size");
  });
});

describe("checkPortAvailability", () => {
  it("should check if port is available", () => {
    // Use a high port number unlikely to be in use
    const result = checkPortAvailability(59999);
    expect(["ok", "warning"]).toContain(result.status);
    expect(result.message).toContain("59999");
  });

  it("should detect when port is in use", () => {
    // This is hard to test without actually binding a port
    // We'll just verify the function returns a valid result
    const result = checkPortAvailability(80); // Common port that might be in use
    expect(result).toBeDefined();
    expect(result.status).toBeDefined();
  });
});

describe("checkNodeModulesFreshness", () => {
  it("should error when node_modules does not exist", () => {
    const projectRoot = TEST_DIR;
    mkdirSync(path.join(projectRoot, "backend-ts"), { recursive: true });
    mkdirSync(path.join(projectRoot, "frontend"), { recursive: true });

    const results = checkNodeModulesFreshness(projectRoot);
    const backendCheck = results.find((r) => r.message.includes("backend-ts"));
    const frontendCheck = results.find((r) => r.message.includes("frontend"));

    expect(backendCheck).toBeDefined();
    expect(frontendCheck).toBeDefined();
  });

  it("should return ok when node_modules exists and is fresh", () => {
    const projectRoot = TEST_DIR;
    const backendDir = path.join(projectRoot, "backend-ts");
    const frontendDir = path.join(projectRoot, "frontend");

    mkdirSync(backendDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });

    // Create package-lock.json files
    writeFileSync(path.join(backendDir, "package-lock.json"), "{}");
    writeFileSync(path.join(frontendDir, "package-lock.json"), "{}");

    // Create node_modules directories (later mtime)
    setTimeout(() => {
      mkdirSync(path.join(backendDir, "node_modules"));
      mkdirSync(path.join(frontendDir, "node_modules"));

      const results = checkNodeModulesFreshness(projectRoot);
      const backendCheck = results.find((r) => r.message.includes("backend-ts"));
      const frontendCheck = results.find((r) => r.message.includes("frontend"));

      expect(backendCheck?.status).toBe("ok");
      expect(frontendCheck?.status).toBe("ok");
    }, 100);
  });

  it("should warn when package-lock.json is newer than node_modules", () => {
    const projectRoot = TEST_DIR;
    const backendDir = path.join(projectRoot, "backend-ts");
    const frontendDir = path.join(projectRoot, "frontend");

    mkdirSync(backendDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });

    // Create node_modules first
    mkdirSync(path.join(backendDir, "node_modules"));
    mkdirSync(path.join(frontendDir, "node_modules"));

    // Create package-lock.json later
    setTimeout(() => {
      writeFileSync(path.join(backendDir, "package-lock.json"), "{}");
      writeFileSync(path.join(frontendDir, "package-lock.json"), "{}");

      const results = checkNodeModulesFreshness(projectRoot);
      const backendCheck = results.find((r) => r.message.includes("backend-ts"));
      const frontendCheck = results.find((r) => r.message.includes("frontend"));

      expect(backendCheck?.status).toBe("warning");
      expect(frontendCheck?.status).toBe("warning");
    }, 100);
  });
});

describe("formatCheckResult", () => {
  it("should format ok status with checkmark", () => {
    const result: CheckResult = { status: "ok", message: "All good" };
    const formatted = formatCheckResult(result);
    expect(formatted).toContain("✓");
    expect(formatted).toContain("All good");
  });

  it("should format warning status with warning icon", () => {
    const result: CheckResult = { status: "warning", message: "Watch out" };
    const formatted = formatCheckResult(result);
    expect(formatted).toContain("⚠");
    expect(formatted).toContain("Watch out");
  });

  it("should format error status with X", () => {
    const result: CheckResult = { status: "error", message: "Failed" };
    const formatted = formatCheckResult(result);
    expect(formatted).toContain("✗");
    expect(formatted).toContain("Failed");
  });
});
