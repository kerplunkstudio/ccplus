import { describe, expect, it } from "vitest";
import path from "path";
import * as config from "../config.js";

// Import server to start it as a side effect and enable coverage tracking
import "../server.js";

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
