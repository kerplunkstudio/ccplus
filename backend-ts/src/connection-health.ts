/**
 * Connection Health Monitor
 *
 * Tracks Socket.IO connection health to detect "zombie" sessions where the client
 * silently disconnected but SDK queries may still be streaming.
 *
 * Inspired by OpenClaw's Channel Health Monitor pattern.
 *
 * CRITICAL: This system does NOT cancel SDK queries on detection. Queries must keep
 * running. This is for tracking and surfacing stale connections only.
 */

interface ConnectionHealth {
  sessionId: string;
  lastEventTimestamp: number;
  connectedAt: number;
  reconnectCount: number;
  lastReconnectTimestamp: number | null;
  isStale: boolean;
}

interface ConnectionHealthConfig {
  staleThresholdMs: number;
  checkIntervalMs: number;
  maxReconnectsPerHour: number;
  gracePeriodMs: number;
}

class ConnectionHealthMonitor {
  private connections: Map<string, ConnectionHealth>;
  private config: ConnectionHealthConfig;
  private checkInterval: NodeJS.Timeout | null;

  constructor(config?: Partial<ConnectionHealthConfig>) {
    this.connections = new Map();
    this.config = {
      staleThresholdMs: config?.staleThresholdMs ?? 60_000, // 1 minute
      checkIntervalMs: config?.checkIntervalMs ?? 15_000, // 15 seconds
      maxReconnectsPerHour: config?.maxReconnectsPerHour ?? 10,
      gracePeriodMs: config?.gracePeriodMs ?? 5_000, // 5 seconds after connection
    };
    this.checkInterval = null;
  }

  /**
   * Register a new connection or reconnection.
   */
  onConnect(sessionId: string): void {
    const existing = this.connections.get(sessionId);
    const now = Date.now();

    if (existing) {
      // Reconnection
      const hourAgo = now - 3_600_000;
      let reconnectCount = existing.reconnectCount;

      // Reset count if last reconnect was more than an hour ago
      if (existing.lastReconnectTimestamp && existing.lastReconnectTimestamp < hourAgo) {
        reconnectCount = 1; // Start fresh with this reconnection
      } else {
        reconnectCount = reconnectCount + 1;
      }

      this.connections.set(sessionId, {
        ...existing,
        lastEventTimestamp: now,
        connectedAt: now,
        reconnectCount,
        lastReconnectTimestamp: now,
        isStale: false,
      });
    } else {
      // New connection
      this.connections.set(sessionId, {
        sessionId,
        lastEventTimestamp: now,
        connectedAt: now,
        reconnectCount: 0,
        lastReconnectTimestamp: null,
        isStale: false,
      });
    }
  }

  /**
   * Update last-seen timestamp for a session when any event is received.
   */
  onEvent(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      this.connections.set(sessionId, {
        ...connection,
        lastEventTimestamp: Date.now(),
        isStale: false,
      });
    }
  }

  /**
   * Remove a connection when it disconnects.
   */
  onDisconnect(sessionId: string): void {
    this.connections.delete(sessionId);
  }

  /**
   * Evaluate health of all tracked connections and mark stale ones.
   * Returns array of stale session IDs.
   */
  evaluateHealth(): string[] {
    const now = Date.now();
    const staleSessionIds: string[] = [];

    for (const [sessionId, connection] of this.connections.entries()) {
      // Skip connections within grace period
      const timeSinceConnect = now - connection.connectedAt;
      if (timeSinceConnect < this.config.gracePeriodMs) {
        continue;
      }

      // Check if connection is stale
      const timeSinceLastEvent = now - connection.lastEventTimestamp;
      const isStale = timeSinceLastEvent >= this.config.staleThresholdMs;

      if (isStale && !connection.isStale) {
        // Newly detected stale connection
        staleSessionIds.push(sessionId);
        this.connections.set(sessionId, {
          ...connection,
          isStale: true,
        });
      }
    }

    return staleSessionIds;
  }

  /**
   * Get all currently stale connections.
   */
  getStaleConnections(): string[] {
    return Array.from(this.connections.values())
      .filter((conn) => conn.isStale)
      .map((conn) => conn.sessionId);
  }

  /**
   * Get reconnection rate for a session (reconnects per hour).
   */
  getReconnectRate(sessionId: string): number {
    const connection = this.connections.get(sessionId);
    if (!connection) return 0;

    const now = Date.now();
    const hourAgo = now - 3_600_000;

    // If last reconnect was more than an hour ago, rate is 0
    if (connection.lastReconnectTimestamp && connection.lastReconnectTimestamp < hourAgo) {
      return 0;
    }

    return connection.reconnectCount;
  }

  /**
   * Check if a session is rate-limited due to excessive reconnects.
   */
  isRateLimited(sessionId: string): boolean {
    return this.getReconnectRate(sessionId) >= this.config.maxReconnectsPerHour;
  }

  /**
   * Get full health status for all connections.
   */
  getHealthStatus(): {
    total: number;
    stale: number;
    healthy: number;
    connections: Array<{
      sessionId: string;
      isStale: boolean;
      timeSinceLastEventMs: number;
      reconnectCount: number;
      isRateLimited: boolean;
    }>;
  } {
    const now = Date.now();
    const connections = Array.from(this.connections.values()).map((conn) => ({
      sessionId: conn.sessionId,
      isStale: conn.isStale,
      timeSinceLastEventMs: now - conn.lastEventTimestamp,
      reconnectCount: this.getReconnectRate(conn.sessionId),
      isRateLimited: this.isRateLimited(conn.sessionId),
    }));

    return {
      total: this.connections.size,
      stale: connections.filter((c) => c.isStale).length,
      healthy: connections.filter((c) => !c.isStale).length,
      connections,
    };
  }

  /**
   * Start periodic health checks.
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      const staleSessionIds = this.evaluateHealth();
      if (staleSessionIds.length > 0) {
        console.log(
          `[connection-health] Detected ${staleSessionIds.length} stale connections:`,
          staleSessionIds.join(", ")
        );
      }
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop periodic health checks.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): ConnectionHealthConfig {
    return { ...this.config };
  }

  /**
   * Clear all tracked connections (for testing).
   */
  clear(): void {
    this.connections.clear();
  }
}

// Singleton instance
export const connectionHealthMonitor = new ConnectionHealthMonitor();

// Export types and class for testing
export { ConnectionHealthMonitor };
export type { ConnectionHealth, ConnectionHealthConfig };
