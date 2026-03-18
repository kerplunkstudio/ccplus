import type { Server as HttpServer } from "http";
import type { Server as SocketIOServer } from "socket.io";

export interface ShutdownDependencies {
  httpServer: HttpServer;
  io: SocketIOServer;
  getActiveSessions: () => string[];
  cleanupFns: Array<() => void>;
  hardTimeoutMs?: number;
}

export class GracefulShutdown {
  private shuttingDown: boolean = false;
  private readonly dependencies: ShutdownDependencies;

  constructor(dependencies: ShutdownDependencies) {
    this.dependencies = {
      ...dependencies,
      hardTimeoutMs: dependencies.hardTimeoutMs ?? 10000,
    };
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  shutdown(): void {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;

    const hardTimeoutMs = this.dependencies.hardTimeoutMs ?? 10000;
    const hardTimeout = setTimeout(() => {
      process.exit(1);
    }, hardTimeoutMs);

    this.performShutdown(hardTimeout);
  }

  private async performShutdown(hardTimeout: NodeJS.Timeout): Promise<void> {
    this.dependencies.io.close();

    await this.waitForActiveSessions();

    for (const cleanupFn of this.dependencies.cleanupFns) {
      try {
        cleanupFn();
      } catch {
        // Continue to next cleanup function
      }
    }

    this.dependencies.httpServer.close(() => {
      clearTimeout(hardTimeout);
      process.exit(0);
    });
  }

  private async waitForActiveSessions(): Promise<void> {
    const pollIntervalMs = 500;
    const hardTimeoutMs = this.dependencies.hardTimeoutMs ?? 10000;
    const startTime = Date.now();

    return new Promise<void>((resolve) => {
      const checkSessions = () => {
        const activeSessions = this.dependencies.getActiveSessions();
        const elapsed = Date.now() - startTime;

        if (activeSessions.length === 0 || elapsed >= hardTimeoutMs) {
          resolve();
        } else {
          setTimeout(checkSessions, pollIntervalMs);
        }
      };

      checkSessions();
    });
  }
}
