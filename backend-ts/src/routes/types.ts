import type { Server as SocketIOServer } from "socket.io";
import type { RequestHandler } from "express";
import type { SessionCallbacks } from "../sdk-session.js";

// Common dependency interface for route factories
// All fields are marked as optional since different routes use different subsets
export interface RouteDependencies {
  database?: any;
  sdkSession?: any;
  sessionWorkspaces?: Map<string, string>;
  io?: SocketIOServer;
  buildSocketCallbacks?: (sessionId: string, projectPath?: string) => SessionCallbacks;
  log?: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
    debug?: (message: string, meta?: Record<string, unknown>) => void;
  };
  connectedClients?: Map<string, { session_id: string; sessions: Set<string> }>;
  START_TIME?: number;
  upload?: { single: (fieldName: string) => RequestHandler };
  getWorkspaceForSession?: (sessionId: string | undefined) => string;
  fleetMonitor?: any;
  captainRouter?: any;
}
