import { describe, it, expect, beforeEach } from "vitest";
import { extractProvenance, ProvenanceTracker } from "../provenance.js";

// Mock Socket.IO socket
function createMockSocket(
  id: string,
  address: string | null = "127.0.0.1",
  userAgent: string | null = "Mozilla/5.0 Test Browser"
): any {
  return {
    id,
    handshake: {
      address,
      headers: userAgent ? { "user-agent": userAgent } : {},
    },
  };
}

describe("extractProvenance", () => {
  it("should extract provenance from socket", () => {
    const socket = createMockSocket("sock_123", "192.168.1.100", "Chrome/98.0");
    const sessionId = "session_abc";

    const provenance = extractProvenance(socket, sessionId);

    expect(provenance.connectionId).toBe("sock_123");
    expect(provenance.sourceIp).toBe("192.168.1.100");
    expect(provenance.userAgent).toBe("Chrome/98.0");
    expect(provenance.sessionId).toBe("session_abc");
    expect(provenance.connectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("should handle missing address", () => {
    const socket = createMockSocket("sock_123", null, "Firefox/95.0");
    const provenance = extractProvenance(socket, "session_xyz");

    expect(provenance.sourceIp).toBeNull();
    expect(provenance.connectionId).toBe("sock_123");
  });

  it("should handle missing user agent", () => {
    const socket = createMockSocket("sock_123", "10.0.0.1", null);
    const provenance = extractProvenance(socket, "session_xyz");

    expect(provenance.userAgent).toBeNull();
    expect(provenance.sourceIp).toBe("10.0.0.1");
  });
});

describe("ProvenanceTracker", () => {
  let tracker: ProvenanceTracker;

  beforeEach(() => {
    tracker = new ProvenanceTracker();
  });

  it("should register a connection", () => {
    const socket = createMockSocket("sock_1", "127.0.0.1", "Test Agent");
    tracker.register(socket, "session_1");

    const provenance = tracker.getProvenance("sock_1");
    expect(provenance).not.toBeNull();
    expect(provenance?.connectionId).toBe("sock_1");
    expect(provenance?.sessionId).toBe("session_1");
  });

  it("should unregister a connection", () => {
    const socket = createMockSocket("sock_1", "127.0.0.1", "Test Agent");
    tracker.register(socket, "session_1");

    tracker.unregister("sock_1");
    const provenance = tracker.getProvenance("sock_1");
    expect(provenance).toBeNull();
  });

  it("should return null for non-existent connection", () => {
    const provenance = tracker.getProvenance("nonexistent");
    expect(provenance).toBeNull();
  });

  it("should track multiple connections", () => {
    const socket1 = createMockSocket("sock_1", "127.0.0.1", "Browser 1");
    const socket2 = createMockSocket("sock_2", "192.168.1.1", "Browser 2");

    tracker.register(socket1, "session_1");
    tracker.register(socket2, "session_2");

    expect(tracker.getConnectionCount()).toBe(2);

    const prov1 = tracker.getProvenance("sock_1");
    const prov2 = tracker.getProvenance("sock_2");

    expect(prov1?.sessionId).toBe("session_1");
    expect(prov2?.sessionId).toBe("session_2");
  });

  it("should get active connections for a session", () => {
    const socket1 = createMockSocket("sock_1", "127.0.0.1", "Tab 1");
    const socket2 = createMockSocket("sock_2", "127.0.0.1", "Tab 2");
    const socket3 = createMockSocket("sock_3", "192.168.1.1", "Other Session");

    tracker.register(socket1, "session_abc");
    tracker.register(socket2, "session_abc");
    tracker.register(socket3, "session_xyz");

    const connections = tracker.getActiveConnections("session_abc");
    expect(connections).toHaveLength(2);
    expect(connections[0].sessionId).toBe("session_abc");
    expect(connections[1].sessionId).toBe("session_abc");
  });

  it("should return empty array for session with no connections", () => {
    const connections = tracker.getActiveConnections("nonexistent_session");
    expect(connections).toEqual([]);
  });

  it("should get all connections", () => {
    const socket1 = createMockSocket("sock_1", "127.0.0.1", "Tab 1");
    const socket2 = createMockSocket("sock_2", "192.168.1.1", "Tab 2");

    tracker.register(socket1, "session_1");
    tracker.register(socket2, "session_2");

    const allConnections = tracker.getAllConnections();
    expect(allConnections).toHaveLength(2);
  });

  it("should update connection count correctly", () => {
    const socket1 = createMockSocket("sock_1", "127.0.0.1", "Browser 1");
    const socket2 = createMockSocket("sock_2", "192.168.1.1", "Browser 2");

    expect(tracker.getConnectionCount()).toBe(0);

    tracker.register(socket1, "session_1");
    expect(tracker.getConnectionCount()).toBe(1);

    tracker.register(socket2, "session_2");
    expect(tracker.getConnectionCount()).toBe(2);

    tracker.unregister("sock_1");
    expect(tracker.getConnectionCount()).toBe(1);

    tracker.unregister("sock_2");
    expect(tracker.getConnectionCount()).toBe(0);
  });

  it("should handle re-registering the same socket ID", () => {
    const socket1 = createMockSocket("sock_1", "127.0.0.1", "Old Connection");
    tracker.register(socket1, "session_1");

    const socket2 = createMockSocket("sock_1", "192.168.1.1", "New Connection");
    tracker.register(socket2, "session_2");

    // Should overwrite with new data
    const provenance = tracker.getProvenance("sock_1");
    expect(provenance?.sessionId).toBe("session_2");
    expect(provenance?.sourceIp).toBe("192.168.1.1");
    expect(tracker.getConnectionCount()).toBe(1);
  });

  it("should handle unregister of non-existent socket gracefully", () => {
    expect(() => tracker.unregister("nonexistent")).not.toThrow();
    expect(tracker.getConnectionCount()).toBe(0);
  });
});
