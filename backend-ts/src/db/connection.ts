import Database from "better-sqlite3";
import * as config from "../config.js";
import { applyMigrations } from "./migrations.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.DATABASE_PATH);
    db.pragma("journal_mode = WAL");
    applyMigrations(db);
  }
  return db;
}

export function close(): void {
  if (db) {
    db.close();
    db = null;
  }
}
