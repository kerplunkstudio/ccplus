import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GracefulShutdown } from "../graceful-shutdown.js";
import type { Server as HttpServer } from "http";
import type { Server as SocketIOServer } from "socket.io";

describe("GracefulShutdown", () => {
  let mockHttpServer: HttpServer;
  let mockIo: SocketIOServer;
  let mockGetActiveSessions: () => string[];
  let cleanupFnsCalled: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    cleanupFnsCalled = [];

    mockHttpServer = {
      close: vi.fn((callback?: () => void) => {
        if (callback) {
          // Queue as microtask to avoid synchronous execution
          queueMicrotask(callback);
        }
      }),
    } as unknown as HttpServer;

    mockIo = {
      close: vi.fn(),
    } as unknown as SocketIOServer;

    mockGetActiveSessions = vi.fn(() => []);
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should call all cleanup functions in order", async () => {
    const cleanupFns = [
      () => { cleanupFnsCalled.push(1); },
      () => { cleanupFnsCalled.push(2); },
      () => { cleanupFnsCalled.push(3); },
    ];

    const gracefulShutdown = new GracefulShutdown({
      httpServer: mockHttpServer,
      io: mockIo,
      getActiveSessions: mockGetActiveSessions,
      cleanupFns,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    gracefulShutdown.shutdown();

    await vi.runAllTimersAsync();

    expect(cleanupFnsCalled).toEqual([1, 2, 3]);
    expect(mockIo.close).toHaveBeenCalled();
    expect(mockHttpServer.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should be idempotent (second call is no-op)", async () => {
    const cleanupFn = vi.fn();

    const gracefulShutdown = new GracefulShutdown({
      httpServer: mockHttpServer,
      io: mockIo,
      getActiveSessions: mockGetActiveSessions,
      cleanupFns: [cleanupFn],
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    gracefulShutdown.shutdown();
    gracefulShutdown.shutdown();

    await vi.runAllTimersAsync();

    expect(cleanupFn).toHaveBeenCalledTimes(1);
    expect(mockIo.close).toHaveBeenCalledTimes(1);
    expect(mockHttpServer.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it("should return correct isShuttingDown state", async () => {
    const gracefulShutdown = new GracefulShutdown({
      httpServer: mockHttpServer,
      io: mockIo,
      getActiveSessions: mockGetActiveSessions,
      cleanupFns: [],
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    expect(gracefulShutdown.isShuttingDown()).toBe(false);

    gracefulShutdown.shutdown();

    expect(gracefulShutdown.isShuttingDown()).toBe(true);

    await vi.runAllTimersAsync();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should handle cleanup function errors gracefully", async () => {
    const cleanupFns = [
      () => { cleanupFnsCalled.push(1); },
      () => { throw new Error("Cleanup error"); },
      () => { cleanupFnsCalled.push(3); },
    ];

    const gracefulShutdown = new GracefulShutdown({
      httpServer: mockHttpServer,
      io: mockIo,
      getActiveSessions: mockGetActiveSessions,
      cleanupFns,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    gracefulShutdown.shutdown();

    await vi.runAllTimersAsync();

    expect(cleanupFnsCalled).toEqual([1, 3]);
    expect(mockIo.close).toHaveBeenCalled();
    expect(mockHttpServer.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should accept custom hardTimeoutMs", async () => {
    const gracefulShutdown = new GracefulShutdown({
      httpServer: mockHttpServer,
      io: mockIo,
      getActiveSessions: mockGetActiveSessions,
      cleanupFns: [],
      hardTimeoutMs: 5000,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    gracefulShutdown.shutdown();

    vi.advanceTimersByTime(4999);
    expect(exitSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should wait for active sessions to complete", async () => {
    const activeSessions = ["session1", "session2"];
    mockGetActiveSessions = vi.fn()
      .mockReturnValueOnce(activeSessions)
      .mockReturnValueOnce(activeSessions)
      .mockReturnValueOnce([]);

    const gracefulShutdown = new GracefulShutdown({
      httpServer: mockHttpServer,
      io: mockIo,
      getActiveSessions: mockGetActiveSessions,
      cleanupFns: [],
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    gracefulShutdown.shutdown();

    await vi.advanceTimersByTimeAsync(500);
    expect(mockGetActiveSessions).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(500);
    expect(mockGetActiveSessions).toHaveBeenCalledTimes(3);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should force exit on hard timeout even with active sessions", async () => {
    mockGetActiveSessions = vi.fn(() => ["session1", "session2"]);

    const gracefulShutdown = new GracefulShutdown({
      httpServer: mockHttpServer,
      io: mockIo,
      getActiveSessions: mockGetActiveSessions,
      cleanupFns: [],
      hardTimeoutMs: 10000,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    gracefulShutdown.shutdown();

    vi.advanceTimersByTime(9999);
    expect(exitSpy).not.toHaveBeenCalledWith(1);

    vi.advanceTimersByTime(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
