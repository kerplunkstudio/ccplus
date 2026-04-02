// Minimal structured logging utility
// Outputs JSON to stdout for easy parsing and filtering
// Also writes to LOG_DIR/server.log with simple rotation (10MB, 1 backup)

import { join } from 'path';
import { appendFileSync, statSync, renameSync } from 'fs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default to 'info', override with LOG_LEVEL env var
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const currentLevelValue = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

interface LogContext {
  sessionId?: string;
  [key: string]: unknown;
}

// Lazy log path resolution to avoid circular dependency with config.ts
// config.ts imports logger.ts, so we cannot import config.ts at the top level.
// Tests can override by setting CCPLUS_LOG_DIR env var before importing this module.
let _logDir: string | null = null;

function getLogPath(): string | null {
  if (_logDir === null) {
    // Allow test override via env var (avoids circular dep issue in test contexts)
    if (process.env.CCPLUS_LOG_DIR !== undefined) {
      _logDir = process.env.CCPLUS_LOG_DIR;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { LOG_DIR } = require('./config.js') as { LOG_DIR: string };
        _logDir = LOG_DIR;
      } catch {
        _logDir = ''; // fallback: no file logging
      }
    }
  }
  return _logDir ? join(_logDir, 'server.log') : null;
}

function rotateIfNeeded(logPath: string): void {
  try {
    const stats = statSync(logPath);
    if (stats.size > MAX_LOG_SIZE) {
      renameSync(logPath, logPath + '.1');
    }
  } catch {
    // File doesn't exist yet — that's fine
  }
}

function writeToFile(line: string): void {
  const logPath = getLogPath();
  if (!logPath) return;

  try {
    rotateIfNeeded(logPath);
    appendFileSync(logPath, line + '\n');
  } catch {
    // Silent fail — don't crash the app over logging
  }
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevelValue;
}

function write(level: LogLevel, msg: string, context?: LogContext): void {
  if (!shouldLog(level)) return;

  const entry: Record<string, unknown> = {
    level,
    msg,
    timestamp: new Date().toISOString(),
  };

  if (context?.sessionId) {
    entry.sessionId = context.sessionId;
  }

  // Add remaining context as 'extra' object
  if (context) {
    const { sessionId, ...rest } = context;
    if (Object.keys(rest).length > 0) {
      entry.extra = rest;
    }
  }

  const line = JSON.stringify(entry);
  console.log(line);
  writeToFile(line);
}

export const log = {
  debug: (msg: string, context?: LogContext) => write('debug', msg, context),
  info: (msg: string, context?: LogContext) => write('info', msg, context),
  warn: (msg: string, context?: LogContext) => write('warn', msg, context),
  error: (msg: string, context?: LogContext) => write('error', msg, context),
};

/**
 * Graceful shutdown hook for the logger.
 * No-op with appendFileSync approach — placeholder for future async transport.
 */
export function shutdownLogger(): void {
  // No resources to clean up with appendFileSync approach
}
