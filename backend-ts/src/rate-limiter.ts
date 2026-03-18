export interface RateLimiterConfig {
  maxMessages: number;   // default 20
  windowMs: number;      // default 60000
}

export class RateLimiter {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  private readonly windows: Map<string, number[]>;  // sessionId -> timestamps

  constructor(config?: Partial<RateLimiterConfig>) {
    this.maxMessages = config?.maxMessages ?? 20;
    this.windowMs = config?.windowMs ?? 60000;
    this.windows = new Map();
  }

  // Check if a message is allowed. Prunes expired timestamps first.
  // Returns { allowed: boolean; retryAfterMs: number }
  check(sessionId: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Get existing timestamps for this session
    const timestamps = this.windows.get(sessionId) ?? [];

    // Prune expired timestamps (sliding window)
    const validTimestamps = timestamps.filter(ts => ts > cutoff);

    // Check if limit exceeded
    if (validTimestamps.length >= this.maxMessages) {
      // Calculate retry time: when the oldest entry will expire
      const oldestTimestamp = validTimestamps[0];
      const retryAfterMs = Math.max(0, oldestTimestamp + this.windowMs - now);

      // Update map with pruned timestamps (immutable pattern)
      this.windows.set(sessionId, validTimestamps);

      return { allowed: false, retryAfterMs };
    }

    // Add current timestamp and update map (immutable pattern)
    const updatedTimestamps = [...validTimestamps, now];
    this.windows.set(sessionId, updatedTimestamps);

    return { allowed: true, retryAfterMs: 0 };
  }

  // Clear a session's window (call on disconnect)
  reset(sessionId: string): void {
    this.windows.delete(sessionId);
  }

  // Get stats for diagnostics
  getStats(): { totalSessions: number; rateLimitedSessions: string[] } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const rateLimitedSessions: string[] = [];

    this.windows.forEach((timestamps, sessionId) => {
      // Prune expired timestamps
      const validTimestamps = timestamps.filter(ts => ts > cutoff);

      if (validTimestamps.length >= this.maxMessages) {
        rateLimitedSessions.push(sessionId);
      }
    });

    return {
      totalSessions: this.windows.size,
      rateLimitedSessions
    };
  }
}
