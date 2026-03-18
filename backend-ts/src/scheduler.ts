import { randomBytes } from "crypto";
import { log } from "./logger.js";

export interface ScheduledTask {
  id: string;
  sessionId: string;
  prompt: string;
  intervalMs: number;
  recurring: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
  paused: boolean;
}

export interface Scheduler {
  addTask(sessionId: string, prompt: string, intervalMs: number, recurring: boolean): ScheduledTask;
  removeTask(id: string): boolean;
  pauseTask(id: string): boolean;
  resumeTask(id: string): boolean;
  listTasks(sessionId: string): ScheduledTask[];
  getReadyTasks(sessionId: string): ScheduledTask[];
  markFired(id: string): void;
  start(): void;
  stop(): void;
  removeSessionTasks(sessionId: string): void;
}

class SchedulerImpl implements Scheduler {
  private tasks: Map<string, ScheduledTask>;
  private intervalId: NodeJS.Timeout | null;
  private tickIntervalMs: number;
  private maxTasksPerSession: number;

  constructor() {
    this.tasks = new Map();
    this.intervalId = null;
    this.tickIntervalMs = 5000; // 5 seconds
    this.maxTasksPerSession = 20;
  }

  private generateTaskId(): string {
    return randomBytes(4).toString("hex");
  }

  addTask(sessionId: string, prompt: string, intervalMs: number, recurring: boolean): ScheduledTask {
    // Check session limit
    const sessionTasks = Array.from(this.tasks.values()).filter(t => t.sessionId === sessionId);
    if (sessionTasks.length >= this.maxTasksPerSession) {
      throw new Error(`Maximum ${this.maxTasksPerSession} tasks per session`);
    }

    const now = Date.now();
    const task: ScheduledTask = {
      id: this.generateTaskId(),
      sessionId,
      prompt,
      intervalMs,
      recurring,
      createdAt: now,
      lastRunAt: null,
      nextRunAt: now + intervalMs,
      paused: false,
    };

    this.tasks.set(task.id, task);
    log.info(`Scheduled task ${task.id}: "${prompt}" every ${intervalMs}ms for session ${sessionId}`);
    return task;
  }

  removeTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.delete(id);
    log.info(`Removed scheduled task ${id}`);
    return true;
  }

  pauseTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    const updated = {
      ...task,
      paused: true,
    };
    this.tasks.set(id, updated);
    log.info(`Paused scheduled task ${id}`);
    return true;
  }

  resumeTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    // Recalculate nextRunAt based on current time
    const now = Date.now();
    const updated = {
      ...task,
      paused: false,
      nextRunAt: now + task.intervalMs,
    };
    this.tasks.set(id, updated);
    log.info(`Resumed scheduled task ${id}`);
    return true;
  }

  listTasks(sessionId: string): ScheduledTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getReadyTasks(sessionId: string): ScheduledTask[] {
    const now = Date.now();
    return Array.from(this.tasks.values())
      .filter(t =>
        t.sessionId === sessionId &&
        !t.paused &&
        now >= t.nextRunAt
      );
  }

  markFired(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    const now = Date.now();

    if (task.recurring) {
      // Update for next run
      const updated = {
        ...task,
        lastRunAt: now,
        nextRunAt: now + task.intervalMs,
      };
      this.tasks.set(id, updated);
      log.info(`Fired recurring task ${id}, next run at ${new Date(updated.nextRunAt).toISOString()}`);
    } else {
      // Remove one-time task
      this.tasks.delete(id);
      log.info(`Fired one-time task ${id}, removed from schedule`);
    }
  }

  start(): void {
    if (this.intervalId !== null) {
      log.info("Scheduler already running");
      return;
    }

    this.intervalId = setInterval(() => {
      // Tick is handled externally (in server.ts)
      // This is just a heartbeat for logging
    }, this.tickIntervalMs);

    log.info(`Scheduler started (tick interval: ${this.tickIntervalMs}ms)`);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info("Scheduler stopped");
    }
  }

  removeSessionTasks(sessionId: string): void {
    const sessionTasks = Array.from(this.tasks.entries()).filter(([, t]) => t.sessionId === sessionId);
    for (const [id] of sessionTasks) {
      this.tasks.delete(id);
    }
    if (sessionTasks.length > 0) {
      log.info(`Removed ${sessionTasks.length} scheduled tasks for session ${sessionId}`);
    }
  }
}

// Singleton instance
const scheduler = new SchedulerImpl();

export { scheduler };

// Interval parsing utility
export function parseInterval(intervalStr: string): number {
  const match = intervalStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${intervalStr}. Use format like "30s", "5m", "2h", "1d"`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}
