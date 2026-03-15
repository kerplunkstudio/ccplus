// test comment for debugging
import { config as dotenvConfig } from "dotenv";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";

// Load .env from project root (one level up from backend-ts/)
dotenvConfig({ path: path.resolve(import.meta.dirname, "../../.env") });

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const LOG_DIR = path.join(PROJECT_ROOT, "logs");
export const STATIC_DIR = path.join(PROJECT_ROOT, "static", "chat");

// Ensure dirs exist
for (const dir of [DATA_DIR, LOG_DIR]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Version
const VERSION_FILE = path.join(PROJECT_ROOT, "VERSION");
let version = "dev";
try {
  version = readFileSync(VERSION_FILE, "utf-8").trim();
} catch {
  // VERSION file doesn't exist in dev
}
export const VERSION = version;

export const CCPLUS_CHANNEL = process.env.CCPLUS_CHANNEL ?? "stable";

// Environment
export const WORKSPACE_PATH = process.env.WORKSPACE_PATH ?? path.join(homedir(), "Workspace");
export const SDK_MODEL = process.env.SDK_MODEL ?? "sonnet";
export const HOST = process.env.HOST ?? "127.0.0.1";
export const PORT = parseInt(process.env.PORT ?? "4000", 10);
export const DATABASE_PATH = path.join(DATA_DIR, "ccplus.db");
export const LOCAL_MODE = (process.env.CCPLUS_AUTH ?? "local") === "local";

const DEFAULT_SECRET = "ccplus-dev-secret-change-me";
export const SECRET_KEY = process.env.SECRET_KEY ?? DEFAULT_SECRET;

// Abort startup if insecure default key is used outside local/dev mode
if (SECRET_KEY === DEFAULT_SECRET) {
  if (!LOCAL_MODE) {
    console.error(
      "FATAL: SECRET_KEY is set to the insecure default value. " +
      "Set a strong SECRET_KEY environment variable before running in production."
    );
    process.exit(1);
  } else {
    console.warn(
      "WARNING: SECRET_KEY is using the insecure default value. " +
      "Set SECRET_KEY in your .env file before exposing this service to a network."
    );
  }
}

export const MAX_CONVERSATION_HISTORY = 50;
export const MAX_ACTIVITY_EVENTS = 200;

// Server PID path (for process management)
export const SERVER_PID_PATH = path.join(DATA_DIR, "node_server.pid");
