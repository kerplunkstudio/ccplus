import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import path from "path";

/** Find the Claude CLI binary path (mirrors Python PluginManager._find_claude_binary). */
export function findClaudeBinary(): string | null {
  const candidates = [
    path.join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    path.join(homedir(), ".claude", "local", "claude"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const result = execFileSync("which", ["claude"], { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const p = result.trim();
    if (p) return p;
  } catch { /* not in PATH */ }
  return null;
}
