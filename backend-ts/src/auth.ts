import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import * as config from "./config.js";

const TOKEN_EXPIRY_SECONDS = 86400; // 24 hours

/**
 * Generate a JWT token for a user.
 *
 * @param userId - User identifier
 * @param expirySeconds - Token expiry time in seconds (default: 24h)
 * @returns JWT token string
 */
export function generateToken(
  userId: string,
  expirySeconds: number = TOKEN_EXPIRY_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: userId,
    iat: now,
    exp: now + expirySeconds,
    jti: uuidv4(),
  };
  return jwt.sign(payload, config.SECRET_KEY, { algorithm: "HS256" });
}

/**
 * Verify a JWT and return the user_id, or null if invalid/expired.
 *
 * @param token - JWT token string
 * @returns user_id if valid, null otherwise
 */
export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.SECRET_KEY, {
      algorithms: ["HS256"],
    }) as {
      user_id?: string;
      jti?: string;
    };
    return payload.user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Generate a JWT for the local user when LOCAL_MODE is enabled.
 *
 * This maintains backward compatibility with the existing local-only auth.
 *
 * @returns JWT token if LOCAL_MODE is enabled, null otherwise
 */
export function autoLogin(): string | null {
  if (!config.LOCAL_MODE) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: "local",
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };
  return jwt.sign(payload, config.SECRET_KEY, { algorithm: "HS256" });
}
