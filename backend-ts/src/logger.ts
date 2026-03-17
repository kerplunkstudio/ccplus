// Minimal structured logging utility
// Outputs JSON to stdout for easy parsing and filtering

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

interface LogContext {
  sessionId?: string;
  [key: string]: unknown;
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

  console.log(JSON.stringify(entry));
}

export const log = {
  debug: (msg: string, context?: LogContext) => write('debug', msg, context),
  info: (msg: string, context?: LogContext) => write('info', msg, context),
  warn: (msg: string, context?: LogContext) => write('warn', msg, context),
  error: (msg: string, context?: LogContext) => write('error', msg, context),
};
