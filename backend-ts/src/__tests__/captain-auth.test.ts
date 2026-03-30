/**
 * captain-auth.test.ts
 *
 * Unit tests for isClaudeAuthenticated().
 * All file-system and environment interactions are mocked — no disk reads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { homedir } from "os";

// ---- Module mocking ----

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Import the mocked fs functions AFTER vi.mock
import { existsSync, readFileSync } from "fs";
import { isClaudeAuthenticated } from "../captain-auth.js";

const claudeConfigPath = path.join(homedir(), ".claude.json");

describe("isClaudeAuthenticated", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe("API key auth", () => {
    it("returns true when ANTHROPIC_API_KEY is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-test-key";
      // fs should not be consulted when API key is present
      vi.mocked(existsSync).mockReturnValue(false);
      expect(isClaudeAuthenticated()).toBe(true);
    });

    it("returns false when ANTHROPIC_API_KEY is empty string", () => {
      process.env.ANTHROPIC_API_KEY = "";
      vi.mocked(existsSync).mockReturnValue(false);
      expect(isClaudeAuthenticated()).toBe(false);
    });

    it("returns false when ANTHROPIC_API_KEY is whitespace only", () => {
      process.env.ANTHROPIC_API_KEY = "   ";
      vi.mocked(existsSync).mockReturnValue(false);
      expect(isClaudeAuthenticated()).toBe(false);
    });
  });

  describe("OAuth auth via ~/.claude.json", () => {
    it("returns false when ~/.claude.json does not exist", () => {
      vi.mocked(existsSync).mockImplementation((p) => p !== claudeConfigPath);
      expect(isClaudeAuthenticated()).toBe(false);
    });

    it("returns true when ~/.claude.json has a valid oauthAccount", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          oauthAccount: {
            accountUuid: "550e8400-e29b-41d4-a716-446655440000",
            emailAddress: "user@example.com",
          },
        })
      );
      expect(isClaudeAuthenticated()).toBe(true);
    });

    it("returns false when oauthAccount is null", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ oauthAccount: null })
      );
      expect(isClaudeAuthenticated()).toBe(false);
    });

    it("returns false when oauthAccount is absent", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ numStartups: 1 })
      );
      expect(isClaudeAuthenticated()).toBe(false);
    });

    it("returns false when oauthAccount.accountUuid is empty string", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ oauthAccount: { accountUuid: "" } })
      );
      expect(isClaudeAuthenticated()).toBe(false);
    });

    it("returns false when oauthAccount.accountUuid is missing", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ oauthAccount: { emailAddress: "user@example.com" } })
      );
      expect(isClaudeAuthenticated()).toBe(false);
    });

    it("returns false when ~/.claude.json is invalid JSON", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("not-valid-json{{{");
      expect(isClaudeAuthenticated()).toBe(false);
    });

    it("returns false when readFileSync throws", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      expect(isClaudeAuthenticated()).toBe(false);
    });
  });
});
