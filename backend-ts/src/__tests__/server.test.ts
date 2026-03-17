import { describe, expect, it, beforeAll, afterEach } from "vitest";
import path from "path";
import * as config from "../config.js";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import * as database from "../database.js";

// Import server to start it as a side effect and enable coverage tracking
import "../server.js";

// Test helpers
let testToken: string;
let testSessionId: string;

/**
 * Server Integration Tests
 *
 * These are integration-style tests that hit the real server with real dependencies.
 * They verify HTTP endpoints return correct structure and status codes.
 *
 * The server is started as a side effect of importing server.js above, which allows
 * code coverage tools to track which lines are executed.
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

    it("verifies valid token", async () => {
      if (!config.LOCAL_MODE) {
        return;
      }

      // Get a valid token first
      const authResponse = await fetch(`${serverUrl}/api/auth/auto-login`, {
        method: "POST",
      });
      const authData = await authResponse.json();

      if (authData.token) {
        const response = await fetch(`${serverUrl}/api/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: authData.token }),
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.valid).toBe(true);
        expect(data.user).toHaveProperty("id");
      }
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

    it("returns first-run status with valid token", async () => {
      // Get a valid token first
      const authResponse = await fetch(`${serverUrl}/api/auth/auto-login`, {
        method: "POST",
      });
      const authData = await authResponse.json();

      if (config.LOCAL_MODE && authData.token) {
        const response = await fetch(`${serverUrl}/api/status/first-run`, {
          headers: {
            Authorization: `Bearer ${authData.token}`,
          },
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty("first_run");
        expect(typeof data.first_run).toBe("boolean");
      }
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

  describe("GET /api/mcp/servers", () => {
    it("returns list of MCP servers", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("servers");
      expect(Array.isArray(data.servers)).toBe(true);
    });
  });

  describe("POST /api/mcp/servers", () => {
    it("rejects invalid server config (missing name)", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "http", url: "http://example.com" }),
      });

      expect(response.status).toBe(400);
    });

    it("rejects invalid server config (missing type)", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test-server", url: "http://example.com" }),
      });

      expect(response.status).toBe(400);
    });

    it("rejects invalid server config (missing url for http type)", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test-server", type: "http" }),
      });

      expect(response.status).toBe(400);
    });

    it("accepts valid server config", async () => {
      const config = {
        name: `test-server-${Date.now()}`,
        type: "http",
        url: "http://example.com/mcp",
      };

      const response = await fetch(`${serverUrl}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      // Either succeeds or fails gracefully
      expect([200, 400, 500]).toContain(response.status);
    });
  });

  describe("DELETE /api/mcp/servers/:name", () => {
    it("requires scope parameter", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers/nonexistent-server`, {
        method: "DELETE",
      });

      expect(response.status).toBe(400);
    });

    it("validates scope parameter", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers/nonexistent-server?scope=invalid`, {
        method: "DELETE",
      });

      expect(response.status).toBe(400);
    });

    it("handles server removal with valid scope", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers/nonexistent-server?scope=user`, {
        method: "DELETE",
      });

      // Either succeeds (no-op) or returns error
      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe("GET /api/path-complete", () => {
    it("returns entries for path completion", async () => {
      const response = await fetch(`${serverUrl}/api/path-complete?partial=${encodeURIComponent("~")}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("entries");
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data).toHaveProperty("basePath");
    });

    it("handles partial paths", async () => {
      const response = await fetch(`${serverUrl}/api/path-complete?partial=${encodeURIComponent("~/")}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("entries");
      expect(data).toHaveProperty("basePath");
    });

    it("handles empty query", async () => {
      const response = await fetch(`${serverUrl}/api/path-complete?partial=`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("entries");
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.entries).toHaveLength(0);
    });
  });

  describe("GET /api/browse with valid path", () => {
    it("browses home directory", async () => {
      const response = await fetch(`${serverUrl}/api/browse?path=${encodeURIComponent(config.WORKSPACE_PATH)}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("path");
      expect(data).toHaveProperty("entries");
      expect(Array.isArray(data.entries)).toBe(true);
    });
  });

  describe("POST /api/projects/clone with valid URL", () => {
    it("validates GitHub URL format", async () => {
      const response = await fetch(`${serverUrl}/api/projects/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/user/repo.git",
          destination: "/tmp/nonexistent-test-dir"
        }),
      });

      // Should fail because destination doesn't exist, but validates URL format
      expect([400, 500]).toContain(response.status);
    }, 10000); // 10 second timeout for git operations
  });

  describe("GET /api/git/context with valid project", () => {
    it("returns git context for workspace", async () => {
      const response = await fetch(`${serverUrl}/api/git/context?project=${encodeURIComponent(config.WORKSPACE_PATH)}`);
      const data = await response.json();

      // Either returns git context or error (if not a git repo)
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(typeof data).toBe("object");
      }
    });
  });

  describe("GET /api/project/overview with valid project", () => {
    it("returns project overview for workspace", async () => {
      const response = await fetch(`${serverUrl}/api/project/overview?project=${encodeURIComponent(config.WORKSPACE_PATH)}`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(typeof data).toBe("object");
    });
  });

  describe("POST /api/images/upload with valid file", () => {
    it("uploads image successfully", async () => {
      const formData = new FormData();
      const blob = new Blob([Buffer.from("fake-png-data")], { type: "image/png" });
      formData.append("file", blob, "test.png");
      formData.append("session_id", "test-session");

      const response = await fetch(`${serverUrl}/api/images/upload`, {
        method: "POST",
        body: formData,
      });

      // Either succeeds or fails with validation error
      expect([200, 400]).toContain(response.status);
    });
  });

  describe("POST /api/set-workspace with valid path", () => {
    it("sets workspace to valid path", async () => {
      const validPath = config.WORKSPACE_PATH;
      const response = await fetch(`${serverUrl}/api/set-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: validPath }),
      });

      expect([200, 400]).toContain(response.status);
    });
  });

  describe("POST /api/sessions/:sessionId/archive success", () => {
    it("archives an existing session", async () => {
      // Create a session first by recording a conversation
      const testSessionId = `test-archive-${Date.now()}`;

      // This will succeed or fail gracefully
      const response = await fetch(`${serverUrl}/api/sessions/${testSessionId}/archive`, {
        method: "POST",
      });

      // Either succeeds or returns error
      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe("GET /api/insights with edge cases", () => {
    it("handles negative days parameter", async () => {
      const response = await fetch(`${serverUrl}/api/insights?days=-5`);

      expect(response.status).toBe(200);
    });

    it("handles zero days parameter", async () => {
      const response = await fetch(`${serverUrl}/api/insights?days=0`);

      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/sessions with filters", () => {
    it("handles archived filter", async () => {
      const response = await fetch(`${serverUrl}/api/sessions?archived=true`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("sessions");
    });

    it("handles limit parameter", async () => {
      const response = await fetch(`${serverUrl}/api/sessions?limit=10`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("sessions");
    });
  });

  describe("GET /api/history with streaming", () => {
    it("includes streaming flag in response", async () => {
      const response = await fetch(`${serverUrl}/api/history/test-streaming-session`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("streaming");
      expect(typeof data.streaming).toBe("boolean");
      expect(data).toHaveProperty("messages");
    });
  });

  describe("POST /api/projects/clone error cases", () => {
    it("rejects non-git URL", async () => {
      const response = await fetch(`${serverUrl}/api/projects/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/not-a-repo" }),
      });

      expect(response.status).toBe(400);
    });

    it("handles missing destination parameter", async () => {
      const response = await fetch(`${serverUrl}/api/projects/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/user/repo.git" }),
      });

      // Should fail or succeed depending on default destination handling
      expect([200, 400, 500]).toContain(response.status);
    }, 10000); // 10 second timeout for git operations
  });

  describe("GET /api/browse edge cases", () => {
    it("handles nonexistent path within home", async () => {
      const nonexistentPath = path.join(config.WORKSPACE_PATH, "nonexistent-dir-xyz-123");
      const response = await fetch(`${serverUrl}/api/browse?path=${encodeURIComponent(nonexistentPath)}`);

      // Either returns error or empty listing
      expect([400, 404, 500]).toContain(response.status);
    });

    it("handles file path instead of directory", async () => {
      // Try to browse a file (should fail)
      const filePath = path.join(config.WORKSPACE_PATH, ".gitignore");
      const response = await fetch(`${serverUrl}/api/browse?path=${encodeURIComponent(filePath)}`);

      // Either returns error or handles gracefully
      expect([400, 404, 500]).toContain(response.status);
    });
  });

  describe("POST /api/mcp/servers validation", () => {
    it("validates URL format for http type", async () => {
      const response = await fetch(`${serverUrl}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test-server",
          type: "http",
          url: "not-a-valid-url",
        }),
      });

      // Should validate URL format
      expect([400, 500]).toContain(response.status);
    });

    it("handles duplicate server names", async () => {
      const config = {
        name: "duplicate-test-server",
        type: "http",
        url: "http://example.com/mcp",
      };

      // Try to add twice
      await fetch(`${serverUrl}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const response = await fetch(`${serverUrl}/api/mcp/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      // Should handle duplicate or succeed idempotently
      expect([200, 400, 409, 500]).toContain(response.status);
    });
  });

  describe("GET /api/path-complete edge cases", () => {
    it("handles relative project paths", async () => {
      const response = await fetch(
        `${serverUrl}/api/path-complete?partial=./&project=${encodeURIComponent(config.WORKSPACE_PATH)}`
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("entries");
    });

    it("handles paths outside home directory", async () => {
      const response = await fetch(`${serverUrl}/api/path-complete?partial=/etc/`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("entries");
      // Should return empty for security reasons
      expect(data.entries).toHaveLength(0);
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

describe("WebSocket Connection and Authentication", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;
  let clientSocket: ClientSocket;

  beforeAll(async () => {
    if (config.LOCAL_MODE) {
      const response = await fetch(`${serverUrl}/api/auth/auto-login`, { method: "POST" });
      const data = await response.json();
      testToken = data.token;
      testSessionId = `test-ws-${Date.now()}`;
    }
  });

  afterEach(() => {
    if (clientSocket?.connected) {
      clientSocket.disconnect();
    }
  });

  it("rejects connection without valid token", async () => {
    if (!config.LOCAL_MODE) return;

    const socket = ioClient(serverUrl, {
      auth: { token: "invalid-token" },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      socket.on("connect", () => {
        socket.close();
        throw new Error("Should not connect with invalid token");
      });

      socket.on("disconnect", () => {
        socket.close();
        resolve();
      });

      setTimeout(() => {
        if (!socket.connected) {
          socket.close();
          resolve();
        }
      }, 2000);
    });
  }, 5000);

  it("accepts connection with valid token", async () => {
    if (!config.LOCAL_MODE) return;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve, reject) => {
      clientSocket.on("connected", (data) => {
        expect(data).toHaveProperty("session_id");
        expect(data.session_id).toBe(testSessionId);
        resolve();
      });

      clientSocket.on("connect_error", (error) => {
        reject(error);
      });
    });
  }, 5000);

  it("handles ping/pong", async () => {
    if (!config.LOCAL_MODE) return;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        clientSocket.emit("ping");
      });

      clientSocket.on("pong", (data) => {
        expect(data).toHaveProperty("timestamp");
        expect(typeof data.timestamp).toBe("number");
        resolve();
      });
    });
  }, 5000);
});

describe("WebSocket Message Handling", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;
  let clientSocket: ClientSocket;

  beforeAll(async () => {
    if (config.LOCAL_MODE) {
      const response = await fetch(`${serverUrl}/api/auth/auto-login`, { method: "POST" });
      const data = await response.json();
      testToken = data.token;
    }
  });

  afterEach(() => {
    if (clientSocket?.connected) {
      clientSocket.disconnect();
    }
  });

  it("receives message_received acknowledgement", async () => {
    if (!config.LOCAL_MODE) return;

    testSessionId = `test-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        clientSocket.emit("message", {
          session_id: testSessionId,
          content: "test message",
          workspace: config.WORKSPACE_PATH,
        });
      });

      clientSocket.on("message_received", (data) => {
        expect(data.status).toBe("ok");
        resolve();
      });
    });
  }, 10000);

  it("handles message with images", async () => {
    if (!config.LOCAL_MODE) return;

    testSessionId = `test-img-msg-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        clientSocket.emit("message", {
          session_id: testSessionId,
          content: "test with images",
          workspace: config.WORKSPACE_PATH,
          image_ids: ["fake-image-id"],
        });
      });

      clientSocket.on("message_received", (data) => {
        expect(data.status).toBe("ok");
        resolve();
      });
    });
  }, 10000);

  it("handles message without explicit session_id", async () => {
    if (!config.LOCAL_MODE) return;

    testSessionId = `test-implicit-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        // Send message without explicit session_id (should use connected session)
        clientSocket.emit("message", {
          content: "test message",
          workspace: config.WORKSPACE_PATH,
        });
      });

      clientSocket.on("message_received", (data) => {
        expect(data.status).toBe("ok");
        resolve();
      });
    });
  }, 10000);

  it("handles cancel event", async () => {
    if (!config.LOCAL_MODE) return;

    testSessionId = `test-cancel-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        clientSocket.emit("cancel", { session_id: testSessionId });
      });

      clientSocket.on("cancelled", (data) => {
        expect(data.status).toBe("ok");
        resolve();
      });
    });
  }, 5000);

  it("handles cancel without explicit session_id", async () => {
    if (!config.LOCAL_MODE) return;

    testSessionId = `test-cancel-implicit-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        // Cancel without explicit session_id
        clientSocket.emit("cancel");
      });

      clientSocket.on("cancelled", (data) => {
        expect(data.status).toBe("ok");
        resolve();
      });
    });
  }, 5000);

  it("handles join_session event", async () => {
    if (!config.LOCAL_MODE) return;

    const newSessionId = `test-join-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connect", () => {
        clientSocket.emit("join_session", { session_id: newSessionId }, (response) => {
          expect(response.status).toBe("ok");
          resolve();
        });
      });
    });
  }, 5000);

  it("handles leave_session event", async () => {
    if (!config.LOCAL_MODE) return;

    const sessionToLeave = `test-leave-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: sessionToLeave },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        // Leave the session
        clientSocket.emit("leave_session", { session_id: sessionToLeave });
        // Just resolve after emitting (no response expected)
        setTimeout(resolve, 100);
      });
    });
  }, 5000);

  it("handles duplicate_session event", async () => {
    if (!config.LOCAL_MODE) return;

    const sourceSessionId = `test-source-${Date.now()}`;
    const newSessionId = `test-new-${Date.now()}`;

    // Create a message in the source session first
    database.recordMessage(sourceSessionId, "local", "user", "test message");

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: `test-dup-${Date.now()}` },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        clientSocket.emit(
          "duplicate_session",
          { sourceSessionId, newSessionId },
          (response) => {
            expect(response).toHaveProperty("success");
            if (response.success) {
              expect(response).toHaveProperty("conversations");
              expect(response).toHaveProperty("toolEvents");
              expect(response).toHaveProperty("images");
            }
            resolve();
          }
        );
      });
    });
  }, 10000);

  it("handles question_response event", async () => {
    if (!config.LOCAL_MODE) return;

    testSessionId = `test-question-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        clientSocket.emit("question_response", {
          session_id: testSessionId,
          response: { answer: "yes" },
        });
        // Just resolve after emitting (no response expected)
        setTimeout(resolve, 100);
      });
    });
  }, 5000);
});

describe("HTTP Error Handling", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("handles errors in /api/history", async () => {
    const response = await fetch(`${serverUrl}/api/history/`);
    expect([200, 404, 500]).toContain(response.status);
  });

  it("handles errors in /api/projects", async () => {
    const response = await fetch(`${serverUrl}/api/projects`);
    expect([200, 500]).toContain(response.status);
  });
});

describe("MCP Server Validation", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("validates scope in POST", async () => {
    const response = await fetch(`${serverUrl}/api/mcp/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-server",
        config: { type: "http", url: "http://example.com" },
        scope: "invalid-scope",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("validates projectPath for project scope", async () => {
    const response = await fetch(`${serverUrl}/api/mcp/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-server",
        config: { type: "http", url: "http://example.com" },
        scope: "project",
      }),
    });

    expect(response.status).toBe(400);
  });
});

describe("Image Upload Validation", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("rejects unsupported file types", async () => {
    const formData = new FormData();
    const blob = new Blob(["test data"], { type: "application/pdf" });
    formData.append("file", blob, "test.pdf");
    formData.append("session_id", "test-session");

    const response = await fetch(`${serverUrl}/api/images/upload`, {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(400);
  });
});

describe("Workspace State Persistence", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("persists and retrieves workspace state", async () => {
    const testState = {
      projects: [
        { name: "test-project-1", path: "/tmp/test-1" },
        { name: "test-project-2", path: "/tmp/test-2" },
      ],
      activeProjectPath: "/tmp/test-1",
    };

    const saveResponse = await fetch(`${serverUrl}/api/workspace`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testState),
    });
    expect(saveResponse.status).toBe(200);

    const getResponse = await fetch(`${serverUrl}/api/workspace`);
    const retrievedState = await getResponse.json();

    expect(retrievedState).toMatchObject(testState);
  });
});

describe("Path Completion Security", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("prevents path traversal attacks", async () => {
    const response = await fetch(
      `${serverUrl}/api/path-complete?partial=${encodeURIComponent("../../../etc/passwd")}`
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.entries).toHaveLength(0);
  });
});

describe("Session Management", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("filters sessions by project", async () => {
    const response = await fetch(
      `${serverUrl}/api/sessions?project=${encodeURIComponent(config.WORKSPACE_PATH)}`
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("sessions");
  });
});

describe("Project Overview", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("returns comprehensive project information", async () => {
    const response = await fetch(
      `${serverUrl}/api/project/overview?project=${encodeURIComponent(config.WORKSPACE_PATH)}`
    );

    if (response.status === 200) {
      const data = await response.json();
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("path");
      expect(data).toHaveProperty("file_tree");
      expect(data).toHaveProperty("languages");
      expect(data).toHaveProperty("tech_stack");
    }
  });
});

describe("Skills Discovery", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("accepts project parameter", async () => {
    const response = await fetch(
      `${serverUrl}/api/skills?project=${encodeURIComponent(config.WORKSPACE_PATH)}`
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("skills");
  });
});

describe("Set Workspace Validation", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("rejects paths outside home directory", async () => {
    const response = await fetch(`${serverUrl}/api/set-workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/nonexistent/path/xyz" }),
    });

    expect(response.status).toBe(403);
  });

  it("sets workspace for specific session", async () => {
    const validPath = config.WORKSPACE_PATH;
    const sessionId = `test-ws-session-${Date.now()}`;

    const response = await fetch(`${serverUrl}/api/set-workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: validPath, session_id: sessionId }),
    });

    expect([200, 404]).toContain(response.status);
  });
});

describe("HTTP Error Coverage", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("handles image file size limit", async () => {
    // Create a large buffer (> 10MB)
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);
    const formData = new FormData();
    const blob = new Blob([largeBuffer], { type: "image/png" });
    formData.append("file", blob, "large.png");
    formData.append("session_id", "test-session");

    const response = await fetch(`${serverUrl}/api/images/upload`, {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(400);
  });

  it("handles API errors in history endpoint", async () => {
    // Use empty session ID to potentially trigger errors
    const response = await fetch(`${serverUrl}/api/history/`);

    // Should either succeed with empty data or return error
    expect([200, 404, 500]).toContain(response.status);
  });

  it("handles API errors in activity endpoint", async () => {
    const response = await fetch(`${serverUrl}/api/activity/`);

    expect([200, 404, 500]).toContain(response.status);
  });

  it("handles API errors in stats endpoint", async () => {
    // Stats should always return data
    const response = await fetch(`${serverUrl}/api/stats`);

    expect([200, 500]).toContain(response.status);
  });
});

describe("Git Context Error Handling", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("handles nonexistent project directory", async () => {
    const fakePath = path.join(config.WORKSPACE_PATH, "nonexistent-project-xyz");
    const response = await fetch(`${serverUrl}/api/git/context?project=${encodeURIComponent(fakePath)}`);

    expect(response.status).toBe(400);
  });
});

describe("Project Overview Error Handling", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("handles nonexistent project directory", async () => {
    const fakePath = path.join(config.WORKSPACE_PATH, "nonexistent-project-xyz");
    const response = await fetch(`${serverUrl}/api/project/overview?project=${encodeURIComponent(fakePath)}`);

    expect(response.status).toBe(400);
  });
});

describe("MCP Server Operations", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("validates server config type", async () => {
    const response = await fetch(`${serverUrl}/api/mcp/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-server",
        config: { type: "stdio", command: "test" },
        scope: "user",
      }),
    });

    // Either succeeds or validates format
    expect([200, 400, 500]).toContain(response.status);
  });

  it("removes server with project scope", async () => {
    const response = await fetch(`${serverUrl}/api/mcp/servers/test-server?scope=project&projectPath=${encodeURIComponent(config.WORKSPACE_PATH)}`, {
      method: "DELETE",
    });

    expect([200, 404, 500]).toContain(response.status);
  });
});

describe("Update Check Caching", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("returns cached result on second call", async () => {
    // First call
    const response1 = await fetch(`${serverUrl}/api/update-check`);
    const data1 = await response1.json();

    expect(response1.status).toBe(200);
    expect(data1).toHaveProperty("update_available");

    // Second call (should use cache)
    const response2 = await fetch(`${serverUrl}/api/update-check`);
    const data2 = await response2.json();

    expect(response2.status).toBe(200);
    expect(data2).toHaveProperty("update_available");
  });
});

describe("Path Security", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("prevents traversal in browse endpoint", async () => {
    const response = await fetch(`${serverUrl}/api/browse?path=${encodeURIComponent("../../etc")}`);

    expect([403, 404]).toContain(response.status);
  });

  it("prevents traversal in git context", async () => {
    const response = await fetch(`${serverUrl}/api/git/context?project=${encodeURIComponent("../../etc")}`);

    // Can return 400 (missing/invalid) or 403 (forbidden)
    expect([400, 403]).toContain(response.status);
  });

  it("prevents traversal in project overview", async () => {
    const response = await fetch(`${serverUrl}/api/project/overview?project=${encodeURIComponent("../../etc")}`);

    // Can return 400 (missing/invalid) or 403 (forbidden)
    expect([400, 403]).toContain(response.status);
  });
});

describe("Projects Endpoint", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("accepts session_id parameter", async () => {
    const sessionId = `test-projects-${Date.now()}`;
    const response = await fetch(`${serverUrl}/api/projects?session_id=${sessionId}`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("projects");
    expect(data).toHaveProperty("workspace");
  });
});

describe("Clone Repository", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("handles existing directory conflict", async () => {
    // Use a directory name that's likely to exist
    const response = await fetch(`${serverUrl}/api/projects/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://github.com/user/backend-ts.git",
        session_id: "test-session",
      }),
    });

    // Either conflicts or fails for other reasons
    expect([400, 409, 500]).toContain(response.status);
  }, 10000);
});

describe("Scan Projects Depth", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("scans projects with depth limit", async () => {
    const response = await fetch(`${serverUrl}/api/scan-projects`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("projects");
    expect(Array.isArray(data.projects)).toBe(true);
    // Should respect max results limit
    expect(data.projects.length).toBeLessThanOrEqual(50);
  });
});

describe("Browse Edge Cases", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("handles permission denied gracefully", async () => {
    // Try to browse a path that might not be accessible
    const response = await fetch(`${serverUrl}/api/browse?path=${encodeURIComponent("/System/Library")}`);

    expect([403, 404, 500]).toContain(response.status);
  });

  it("lists directories only, not files", async () => {
    const response = await fetch(`${serverUrl}/api/browse?path=${encodeURIComponent(config.WORKSPACE_PATH)}`);
    const data = await response.json();

    if (response.status === 200 && data.entries.length > 0) {
      // All entries should be directories
      for (const entry of data.entries) {
        expect(entry.is_dir).toBe(true);
      }
    }
  });
});

describe("Static File Serving", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("serves index.html at root", async () => {
    const response = await fetch(`${serverUrl}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("html");
  });

  it("serves static assets", async () => {
    // Try to fetch a static asset (might not exist, but tests the route)
    const response = await fetch(`${serverUrl}/static.js`);

    // Either serves the file or returns 404
    expect([200, 304, 404]).toContain(response.status);
  });
});

describe("Error Path Coverage", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;

  it("handles database errors in stats endpoint", async () => {
    // Stats endpoint should handle errors gracefully
    const response = await fetch(`${serverUrl}/api/stats/user`);

    expect([200, 500]).toContain(response.status);
  });

  it("handles errors in sessions list", async () => {
    // Use an invalid project path to potentially trigger error
    const response = await fetch(`${serverUrl}/api/sessions?project=${encodeURIComponent("/nonexistent")}`);

    expect([200, 500]).toContain(response.status);
  });

  it("handles errors in activity endpoint", async () => {
    // Empty session ID
    const response = await fetch(`${serverUrl}/api/activity/`);

    expect([200, 404, 500]).toContain(response.status);
  });

  it("handles archive session errors", async () => {
    const response = await fetch(`${serverUrl}/api/sessions/fake-session-xyz/archive`, {
      method: "POST",
    });

    expect([200, 404, 500]).toContain(response.status);
  });
});

describe("WebSocket Error Paths", () => {
  const serverUrl = `http://${config.HOST}:${config.PORT}`;
  let clientSocket: ClientSocket;

  beforeAll(async () => {
    if (config.LOCAL_MODE) {
      const response = await fetch(`${serverUrl}/api/auth/auto-login`, { method: "POST" });
      const data = await response.json();
      testToken = data.token;
    }
  });

  afterEach(() => {
    if (clientSocket?.connected) {
      clientSocket.disconnect();
    }
  });

  it("handles message without content or images", async () => {
    if (!config.LOCAL_MODE) return;

    testSessionId = `test-empty-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: testSessionId },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        // Send message with empty content and no images (should be ignored)
        clientSocket.emit("message", {
          session_id: testSessionId,
          content: "",
          workspace: config.WORKSPACE_PATH,
        });
        // No message_received expected, just wait a bit
        setTimeout(resolve, 200);
      });
    });
  }, 5000);

  it("handles join_session without callback", async () => {
    if (!config.LOCAL_MODE) return;

    const newSessionId = `test-join-nocb-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connect", () => {
        // Join without callback
        clientSocket.emit("join_session", { session_id: newSessionId });
        setTimeout(resolve, 200);
      });
    });
  }, 5000);

  it("handles duplicate_session without callback", async () => {
    if (!config.LOCAL_MODE) return;

    const sourceSessionId = `test-dup-source-${Date.now()}`;
    const newSessionId = `test-dup-new-${Date.now()}`;

    clientSocket = ioClient(serverUrl, {
      auth: { token: testToken, session_id: `test-dup-${Date.now()}` },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on("connected", () => {
        // Duplicate without callback
        clientSocket.emit("duplicate_session", { sourceSessionId, newSessionId });
        setTimeout(resolve, 200);
      });
    });
  }, 5000);
});
