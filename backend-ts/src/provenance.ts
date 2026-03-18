import { Socket } from "socket.io";

/**
 * Provenance information for a connection.
 * Tracks where a message/event originated (browser tab, connection, device).
 */
export interface ProvenanceInfo {
  connectionId: string;      // socket.id
  sourceIp: string | null;   // socket.handshake.address
  userAgent: string | null;  // from handshake headers
  sessionId: string;         // browser session ID
  connectedAt: string;       // ISO timestamp of socket connect
}

/**
 * Extract provenance information from a Socket.IO socket.
 */
export function extractProvenance(socket: Socket, sessionId: string): ProvenanceInfo {
  const address = socket.handshake.address ?? null;
  const userAgent = socket.handshake.headers["user-agent"] ?? null;

  return {
    connectionId: socket.id,
    sourceIp: address,
    userAgent,
    sessionId,
    connectedAt: new Date().toISOString(),
  };
}

/**
 * Tracks active connections and their provenance.
 */
export class ProvenanceTracker {
  private connections: Map<string, ProvenanceInfo>;

  constructor() {
    this.connections = new Map();
  }

  /**
   * Register a new connection.
   */
  register(socket: Socket, sessionId: string): void {
    const provenance = extractProvenance(socket, sessionId);
    this.connections.set(socket.id, provenance);
  }

  /**
   * Unregister a connection.
   */
  unregister(socketId: string): void {
    this.connections.delete(socketId);
  }

  /**
   * Get provenance for a connection.
   */
  getProvenance(socketId: string): ProvenanceInfo | null {
    return this.connections.get(socketId) ?? null;
  }

  /**
   * Get all active connections for a session.
   */
  getActiveConnections(sessionId: string): ProvenanceInfo[] {
    const connections: ProvenanceInfo[] = [];
    for (const provenance of this.connections.values()) {
      if (provenance.sessionId === sessionId) {
        connections.push(provenance);
      }
    }
    return connections;
  }

  /**
   * Get total number of active connections.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get all active connections.
   */
  getAllConnections(): ProvenanceInfo[] {
    return Array.from(this.connections.values());
  }
}
