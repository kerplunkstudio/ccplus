import { beforeEach, describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as config from "../config.js";
import { getCostDashboard } from "../db/costs.js";

describe("Cost Dashboard Tests", () => {
  beforeEach(() => {
    // Clean up the database by deleting all records
    const database = new Database(config.DATABASE_PATH);
    try {
      database.exec("DELETE FROM conversations");
      database.exec("DELETE FROM query_usage");
    } catch {
      // Tables might not exist yet, that's okay
    }
    database.close();
  });

  it("should return zeros and empty arrays when no data exists", () => {
    const result = getCostDashboard();

    expect(result.hero.today).toBe(0);
    expect(result.hero.this_week).toBe(0);
    expect(result.hero.this_month).toBe(0);
    expect(result.top_sessions).toEqual([]);
    expect(result.by_model).toEqual([]);
    expect(result.daily_trend).toEqual([]);
  });

  it("should calculate today cost correctly", () => {
    const db = new Database(config.DATABASE_PATH);

    // Insert query_usage records with today's date
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess2", 2000, 1000, 0.10, "claude-3-5-sonnet-20241022");

    db.close();

    const result = getCostDashboard();

    expect(result.hero.today).toBeCloseTo(0.15, 10);
  });

  it("should calculate this week cost correctly", () => {
    const db = new Database(config.DATABASE_PATH);

    // Insert query_usage records within this week
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime', '-3 days'))
    `).run("sess2", 2000, 1000, 0.10, "claude-3-5-sonnet-20241022");

    db.close();

    const result = getCostDashboard();

    expect(result.hero.this_week).toBeGreaterThan(0);
  });

  it("should calculate this month cost correctly", () => {
    const db = new Database(config.DATABASE_PATH);

    // Insert query_usage records within this month
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime', '-10 days'))
    `).run("sess2", 2000, 1000, 0.10, "claude-3-5-sonnet-20241022");

    db.close();

    const result = getCostDashboard();

    expect(result.hero.this_month).toBeGreaterThan(0);
  });

  it("should return top sessions ordered by cost descending", () => {
    const db = new Database(config.DATABASE_PATH);

    // Insert conversations to get labels
    db.prepare(`
      INSERT INTO conversations (session_id, user_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", "user1", "user", "First session message");

    db.prepare(`
      INSERT INTO conversations (session_id, user_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess2", "user1", "user", "Second session message");

    db.prepare(`
      INSERT INTO conversations (session_id, user_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess3", "user1", "user", "Third session message");

    // Insert query_usage records with different costs
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess2", 5000, 2500, 0.25, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess3", 3000, 1500, 0.15, "claude-3-5-sonnet-20241022");

    db.close();

    const result = getCostDashboard();

    expect(result.top_sessions).toHaveLength(3);
    expect(result.top_sessions[0].session_id).toBe("sess2");
    expect(result.top_sessions[0].total_cost).toBeCloseTo(0.25, 10);
    expect(result.top_sessions[0].label).toBe("Second session message");
    expect(result.top_sessions[1].session_id).toBe("sess3");
    expect(result.top_sessions[1].total_cost).toBeCloseTo(0.15, 10);
    expect(result.top_sessions[2].session_id).toBe("sess1");
    expect(result.top_sessions[2].total_cost).toBeCloseTo(0.05, 10);
  });

  it("should group by model and exclude null/empty model names", () => {
    const db = new Database(config.DATABASE_PATH);

    // Insert query_usage records with different models
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess2", 2000, 1000, 0.10, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess3", 3000, 1500, 0.15, "claude-opus-4-20241022");

    // These should be excluded
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess4", 500, 250, 0.025, null);

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess5", 500, 250, 0.025, "");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess6", 500, 250, 0.025, "unknown");

    db.close();

    const result = getCostDashboard();

    expect(result.by_model).toHaveLength(2);
    expect(result.by_model[0].model).toBe("claude-3-5-sonnet-20241022");
    expect(result.by_model[0].queries).toBe(2);
    expect(result.by_model[0].total_cost).toBeCloseTo(0.15, 10);
    expect(result.by_model[1].model).toBe("claude-opus-4-20241022");
    expect(result.by_model[1].queries).toBe(1);
    expect(result.by_model[1].total_cost).toBeCloseTo(0.15, 10);
  });

  it("should group daily trend by date", () => {
    const db = new Database(config.DATABASE_PATH);

    // Insert query_usage records for different dates
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess2", 2000, 1000, 0.10, "claude-3-5-sonnet-20241022");

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime', '-1 days'))
    `).run("sess3", 3000, 1500, 0.15, "claude-3-5-sonnet-20241022");

    db.close();

    const result = getCostDashboard();

    expect(result.daily_trend.length).toBeGreaterThan(0);
    // Most recent day should have combined cost from two queries
    const todayTrend = result.daily_trend[result.daily_trend.length - 1];
    expect(todayTrend.cost).toBeCloseTo(0.15, 10);
    expect(todayTrend.input_tokens).toBe(3000);
    expect(todayTrend.output_tokens).toBe(1500);
  });

  it("should handle sessions without conversation labels", () => {
    const db = new Database(config.DATABASE_PATH);

    // Insert query_usage without corresponding conversation
    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess-orphan", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.close();

    const result = getCostDashboard();

    expect(result.top_sessions).toHaveLength(1);
    expect(result.top_sessions[0].label).toBe("Untitled session");
  });

  it("should truncate long session labels", () => {
    const db = new Database(config.DATABASE_PATH);

    const longMessage = "This is a very long message that should be truncated to 50 characters for display purposes";

    db.prepare(`
      INSERT INTO conversations (session_id, user_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", "user1", "user", longMessage);

    db.prepare(`
      INSERT INTO query_usage (session_id, input_tokens, output_tokens, cost_usd, model, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run("sess1", 1000, 500, 0.05, "claude-3-5-sonnet-20241022");

    db.close();

    const result = getCostDashboard();

    expect(result.top_sessions).toHaveLength(1);
    expect(result.top_sessions[0].label.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(result.top_sessions[0].label).toContain("...");
  });
});
