/**
 * Global test setup
 *
 * This file runs once before all tests to configure the test environment.
 * It's configured in vitest.config.ts as a globalSetup entry.
 *
 * DATABASE_PATH is set via environment variable in vitest.config.ts,
 * which allows us to use a test-specific database file.
 */

import { unlinkSync } from "fs";

export async function setup() {
  // DATABASE_PATH is set via env var in vitest.config.ts to "test-ccplus.db"
  const TEST_DB = process.env.DATABASE_PATH || "test-ccplus.db";

  // Clean up test database and WAL files to ensure fresh state
  // This fixes migration issues caused by inconsistent schema from previous runs
  for (const file of [TEST_DB, `${TEST_DB}-shm`, `${TEST_DB}-wal`]) {
    try {
      unlinkSync(file);
    } catch (err: any) {
      // Ignore missing files
    }
  }
}

export async function teardown() {
  // Clean up after all tests
}

