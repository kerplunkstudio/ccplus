import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Use test-specific database and port (set before any modules load)
    env: {
      DATABASE_PATH: "test-ccplus.db",
      PORT: "4999", // Use different port for tests to avoid conflict with running server
    },
    // Global setup runs once before all tests (not before each test file)
    globalSetup: ["./src/__tests__/setup.ts"],
    // Run tests sequentially to avoid port conflicts (server.test.ts and socket-multiplexing.test.ts both start server)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/__tests__/**",
      ],
    },
  },
});
