import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../config.js";

// Mock the config module
vi.mock("../config.js", async () => {
  const actual = await vi.importActual<typeof config>("../config.js");
  return {
    ...actual,
    get LOCAL_MODE() {
      return (globalThis as any).__TEST_LOCAL_MODE ?? true;
    },
  };
});

import { autoLogin, generateToken, verifyToken } from "../auth.js";

describe("autoLogin", () => {
  beforeEach(() => {
    (globalThis as any).__TEST_LOCAL_MODE = true;
  });

  afterEach(() => {
    delete (globalThis as any).__TEST_LOCAL_MODE;
  });

  it("should return token when LOCAL_MODE is true", () => {
    const token = autoLogin();
    expect(token).not.toBeNull();
    expect(typeof token).toBe("string");
  });

  it("should return null when LOCAL_MODE is false", () => {
    (globalThis as any).__TEST_LOCAL_MODE = false;

    const token = autoLogin();
    expect(token).toBeNull();
  });

  it("should include local user_id in token", () => {
    const token = autoLogin();
    expect(token).not.toBeNull();

    if (token) {
      const payload = jwt.decode(token) as { user_id?: string };
      expect(payload.user_id).toBe("local");
    }
  });

  it("should include expiry in token", () => {
    const token = autoLogin();
    expect(token).not.toBeNull();

    if (token) {
      const payload = jwt.decode(token) as { exp?: number };
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });
});

describe("verifyToken", () => {
  it("should verify valid token", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      user_id: "test-user",
      iat: now,
      exp: now + 3600,
    };
    const token = jwt.sign(payload, config.SECRET_KEY, { algorithm: "HS256" });
    const userId = verifyToken(token);

    expect(userId).toBe("test-user");
  });

  it("should reject expired token", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      user_id: "test-user",
      iat: now - 7200,
      exp: now - 3600,
    };
    const token = jwt.sign(payload, config.SECRET_KEY, { algorithm: "HS256" });
    const userId = verifyToken(token);

    expect(userId).toBeNull();
  });

  it("should reject invalid token", () => {
    const userId = verifyToken("not-a-real-token");
    expect(userId).toBeNull();
  });

  it("should reject token signed with wrong secret", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      user_id: "test-user",
      iat: now,
      exp: now + 3600,
    };
    const token = jwt.sign(payload, "wrong-secret", { algorithm: "HS256" });
    const userId = verifyToken(token);

    expect(userId).toBeNull();
  });

  it("should roundtrip with autoLogin", () => {
    const token = autoLogin();
    expect(token).not.toBeNull();

    if (token) {
      const userId = verifyToken(token);
      expect(userId).toBe("local");
    }
  });
});

describe("generateToken", () => {
  it("should generate token with custom user_id", () => {
    const token = generateToken("custom-user");
    expect(token).toBeTruthy();

    const payload = jwt.decode(token) as { user_id?: string };
    expect(payload.user_id).toBe("custom-user");
  });

  it("should include jti in generated token", () => {
    const token = generateToken("test-user");
    const payload = jwt.decode(token) as { jti?: string };
    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe("string");
  });

  it("should respect custom expiry", () => {
    const customExpiry = 1800; // 30 minutes
    const token = generateToken("test-user", customExpiry);
    const payload = jwt.decode(token) as { iat?: number; exp?: number };

    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();

    if (payload.exp && payload.iat) {
      expect(payload.exp - payload.iat).toBe(customExpiry);
    }
  });
});
