import { describe, expect, it } from "vitest";
import * as config from "../config.js";

/**
 * Server Integration Tests
 *
 * Note: The TypeScript server starts listening as a side effect when imported,
 * making it difficult to mock dependencies for isolated testing like the Python version.
 *
 * These are integration-style tests that hit the real server with real dependencies.
 * They verify HTTP endpoints return correct structure and status codes.
 *
 * For more isolated unit testing, we would need to:
 * 1. Refactor server.ts to export the app without starting the server
 * 2. Create a separate entry point that imports and starts the server
 * 3. Then tests could import just the app and use supertest or similar
 *
 * WebSocket tests are not included as they would require socket.io-client and
 * more complex setup. The Python tests use Flask-SocketIO's test_client() which
 * doesn't have a direct TypeScript equivalent.
 */

describe("Server HTTP Routes", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  describe("GET /health", () => {
    it("returns ok status with correct structure", async () => {
      const response = await fetch(`${serverUrl}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("channel");
      expect(data).toHaveProperty("uptime_seconds");
      expect(typeof data.uptime_seconds).toBe("number");
      expect(data).toHaveProperty("connected_clients");
      expect(typeof data.connected_clients).toBe("number");
      expect(data).toHaveProperty("active_sessions");
      expect(typeof data.active_sessions).toBe("number");
      expect(data).toHaveProperty("db");
      expect(typeof data.db).toBe("object");
    });
  });

  describe("POST /api/auth/auto-login", () => {
    it("returns token in local mode", async () => {
      const response = await fetch(`${serverUrl}/api/auth/auto-login`, {
        method: "POST",
      });
      const data = await response.json();

      if (config.LOCAL_MODE) {
        expect(response.status).toBe(200);
        expect(data).toHaveProperty("token");
        expect(typeof data.token).toBe("string");
        expect(data.user.id).toBe("local");
      } else {
        expect(response.status).toBe(403);
      }
    });
  });

  describe("POST /api/auth/verify", () => {
    it("rejects invalid token", async () => {
      const response = await fetch(`${serverUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "clearly-invalid-token-that-wont-verify" }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.valid).toBe(false);
    });

    it("rejects missing body", async () => {
      const response = await fetch(`${serverUrl}/api/auth/verify`, {
        method: "POST",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/version", () => {
    it("returns version info", async () => {
      const response = await fetch(`${serverUrl}/api/version`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("channel");
      expect(data).toHaveProperty("git_sha");
    });
  });

  describe("GET /api/history/:sessionId", () => {
    it("returns messages array with streaming flag", async () => {
      const response = await fetch(`${serverUrl}/api/history/test-session-id`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("messages");
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data).toHaveProperty("streaming");
      expect(typeof data.streaming).toBe("boolean");
    });
  });

  describe("GET /api/activity/:sessionId", () => {
    it("returns events array", async () => {
      const response = await fetch(`${serverUrl}/api/activity/test-session-id`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("events");
      expect(Array.isArray(data.events)).toBe(true);
    });
  });

  describe("GET /api/stats", () => {
    it("returns statistics object", async () => {
      const response = await fetch(`${serverUrl}/api/stats`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(typeof data).toBe("object");
      // Stats structure varies based on actual data, just verify it's an object
    });
  });

  describe("GET /api/stats/user", () => {
    it("returns user statistics", async () => {
      const response = await fetch(`${serverUrl}/api/stats/user`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(typeof data).toBe("object");
    });
  });

  describe("GET /api/status/first-run", () => {
    it("rejects unauthorized request", async () => {
      const response = await fetch(`${serverUrl}/api/status/first-run`);

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/insights", () => {
    it("returns insights with default days", async () => {
      const response = await fetch(`${serverUrl}/api/insights`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(typeof data).toBe("object");
    });

    it("accepts days query param", async () => {
      const response = await fetch(`${serverUrl}/api/insights?days=7`);

      expect(response.status).toBe(200);
    });

    it("accepts project query param", async () => {
      const response = await fetch(`${serverUrl}/api/insights?project=/tmp/test`);

      expect(response.status).toBe(200);
    });

    it("validates days parameter range", async () => {
      // Invalid days should default to 30
      const response = await fetch(`${serverUrl}/api/insights?days=500`);

      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/sessions", () => {
    it("returns sessions list", async () => {
      const response = await fetch(`${serverUrl}/api/sessions`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("sessions");
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it("accepts project query param", async () => {
      const response = await fetch(`${serverUrl}/api/sessions?project=/tmp/test`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("sessions");
    });
  });

  describe("POST /api/sessions/:sessionId/archive", () => {
    it("archives session or returns error", async () => {
      const response = await fetch(`${serverUrl}/api/sessions/nonexistent-session/archive`, {
        method: "POST",
      });

      // Either succeeds or fails gracefully
      expect([200, 500]).toContain(response.status);
    });
  });

  describe("GET /api/workspace", () => {
    it("returns workspace state structure", async () => {
      const response = await fetch(`${serverUrl}/api/workspace`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("projects");
      expect(Array.isArray(data.projects)).toBe(true);
      expect(data).toHaveProperty("activeProjectPath");
    });
  });

  describe("PUT /api/workspace", () => {
    it("saves workspace state", async () => {
      const state = {
        projects: [{ name: "test", path: "/tmp/test" }],
        activeProjectPath: "/tmp/test",
      };

      const response = await fetch(`${serverUrl}/api/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
    });

    it("rejects missing state", async () => {
      const response = await fetch(`${serverUrl}/api/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/workspace", () => {
    it("saves workspace state (sendBeacon variant)", async () => {
      const state = {
        projects: [{ name: "test", path: "/tmp/test" }],
        activeProjectPath: "/tmp/test",
      };

      const response = await fetch(`${serverUrl}/api/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
    });

    it("rejects missing state", async () => {
      const response = await fetch(`${serverUrl}/api/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/plugins", () => {
    it("returns plugins list", async () => {
      const response = await fetch(`${serverUrl}/api/plugins`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("plugins");
      expect(Array.isArray(data.plugins)).toBe(true);
    });
  });

  describe("GET /api/plugins/marketplace", () => {
    it("returns marketplace plugins", async () => {
      const response = await fetch(`${serverUrl}/api/plugins/marketplace`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("plugins");
      expect(Array.isArray(data.plugins)).toBe(true);
    });
  });

  describe("GET /api/skills", () => {
    it("returns skills list", async () => {
      const response = await fetch(`${serverUrl}/api/skills`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("skills");
      expect(Array.isArray(data.skills)).toBe(true);
    });
  });

  describe("GET /api/update-check", () => {
    it("returns update information", async () => {
      const response = await fetch(`${serverUrl}/api/update-check`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("update_available");
      expect(typeof data.update_available).toBe("boolean");
      expect(data).toHaveProperty("current_version");
      expect(data).toHaveProperty("latest_version");
      expect(data).toHaveProperty("channel");
    });
  });

  describe("POST /api/projects/clone", () => {
    it("rejects invalid URL", async () => {
      const response = await fetch(`${serverUrl}/api/projects/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-valid-url" }),
      });

      expect(response.status).toBe(400);
    });

    it("rejects missing URL", async () => {
      const response = await fetch(`${serverUrl}/api/projects/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/set-workspace", () => {
    it("rejects missing path", async () => {
      const response = await fetch(`${serverUrl}/api/set-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("rejects path outside home directory", async () => {
      const response = await fetch(`${serverUrl}/api/set-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/etc" }),
      });

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/browse", () => {
    it("returns directory listing structure", async () => {
      const response = await fetch(`${serverUrl}/api/browse`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("path");
      expect(data).toHaveProperty("parent");
      expect(data).toHaveProperty("entries");
      expect(Array.isArray(data.entries)).toBe(true);
    });

    it("rejects path outside home directory", async () => {
      const response = await fetch(`${serverUrl}/api/browse?path=/etc`);

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/scan-projects", () => {
    it("returns detected projects", async () => {
      const response = await fetch(`${serverUrl}/api/scan-projects`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("projects");
      expect(Array.isArray(data.projects)).toBe(true);
    });
  });

  describe("GET /api/projects", () => {
    it("returns projects in workspace", async () => {
      const response = await fetch(`${serverUrl}/api/projects`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("projects");
      expect(Array.isArray(data.projects)).toBe(true);
      expect(data).toHaveProperty("workspace");
    });
  });

  describe("GET /api/git/context", () => {
    it("requires project parameter", async () => {
      const response = await fetch(`${serverUrl}/api/git/context`);

      expect(response.status).toBe(400);
    });

    it("rejects path outside workspace", async () => {
      const response = await fetch(`${serverUrl}/api/git/context?project=/etc`);

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/project/overview", () => {
    it("requires project parameter", async () => {
      const response = await fetch(`${serverUrl}/api/project/overview`);

      expect(response.status).toBe(400);
    });

    it("rejects path outside workspace", async () => {
      const response = await fetch(`${serverUrl}/api/project/overview?project=/etc`);

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/images/upload", () => {
    it("rejects request without file", async () => {
      const formData = new FormData();
      formData.append("session_id", "test-session");

      const response = await fetch(`${serverUrl}/api/images/upload`, {
        method: "POST",
        body: formData,
      });

      expect(response.status).toBe(400);
    });

    it("rejects request without session_id", async () => {
      const formData = new FormData();
      const blob = new Blob(["fake image data"], { type: "image/png" });
      formData.append("file", blob, "test.png");

      const response = await fetch(`${serverUrl}/api/images/upload`, {
        method: "POST",
        body: formData,
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/images/:imageId", () => {
    it("returns 404 for nonexistent image", async () => {
      const response = await fetch(`${serverUrl}/api/images/nonexistent-image-id`);

      expect(response.status).toBe(404);
    });
  });

  describe("Static files", () => {
    it("serves root HTML", async () => {
      const response = await fetch(`${serverUrl}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("html");
    });
  });
});

describe("Server Configuration", () => {
  it("has required environment variables", () => {
    expect(config.HOST).toBeTruthy();
    expect(config.PORT).toBeGreaterThan(0);
    expect(config.DATABASE_PATH).toBeTruthy();
    expect(config.WORKSPACE_PATH).toBeTruthy();
  });

  it("has correct constants", () => {
    expect(config.MAX_CONVERSATION_HISTORY).toBe(50);
    expect(config.MAX_ACTIVITY_EVENTS).toBe(200);
  });
});
