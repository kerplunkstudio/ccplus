/**
 * captain-auth.ts
 *
 * Auth detection for Captain auto-start.
 * Checks whether the user has authenticated with Claude before Captain attempts
 * to start an SDK session. Uses only built-in `fs` — no new dependencies.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";

/**
 * Check whether Claude is authenticated.
 *
 * Returns true when any of the following holds:
 * - ANTHROPIC_API_KEY is set in the environment (API key auth)
 * - ~/.claude.json exists and contains a valid `oauthAccount.accountUuid` (OAuth login)
 *
 * Returns false when neither condition is met (user has not run `claude login`).
 */
export function isClaudeAuthenticated(): boolean {
  // API key auth takes precedence
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return true;
  }

  const claudeConfigPath = path.join(homedir(), ".claude.json");
  if (!existsSync(claudeConfigPath)) {
    return false;
  }

  try {
    const raw = readFileSync(claudeConfigPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const oauthAccount = config.oauthAccount;
    return (
      typeof oauthAccount === "object" &&
      oauthAccount !== null &&
      typeof (oauthAccount as Record<string, unknown>).accountUuid === "string" &&
      ((oauthAccount as Record<string, unknown>).accountUuid as string).length > 0
    );
  } catch {
    return false;
  }
}
