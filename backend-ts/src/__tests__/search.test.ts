import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as database from "../database.js";

describe("searchConversations", () => {
  const testSessionId1 = "test-session-search-1";
  const testSessionId2 = "test-session-search-2";
  const userId = "test-user";

  beforeEach(() => {
    // Create test conversations
    database.recordMessage(testSessionId1, userId, "user", "How do I implement a search feature?", undefined, "/test/project");
    database.recordMessage(testSessionId1, userId, "assistant", "To implement a search feature, you need to...", undefined, "/test/project");
    database.recordMessage(testSessionId1, userId, "user", "Thanks for the search help!", undefined, "/test/project");

    database.recordMessage(testSessionId2, userId, "user", "Can you help with authentication?", undefined, "/test/project");
    database.recordMessage(testSessionId2, userId, "assistant", "Authentication requires implementing login and search validation.", undefined, "/test/project");
  });

  afterEach(() => {
    // Clean up test data
    database.archiveSession(testSessionId1);
    database.archiveSession(testSessionId2);
  });

  it("should find conversations matching search query", () => {
    const results = database.searchConversations("search");

    expect(results.length).toBeGreaterThan(0);
    const session1Results = results.find(r => r.session_id === testSessionId1);
    expect(session1Results).toBeDefined();
    expect(session1Results!.matches.length).toBeGreaterThan(0);
  });

  it("should be case-insensitive", () => {
    const lowerResults = database.searchConversations("search");
    const upperResults = database.searchConversations("SEARCH");
    const mixedResults = database.searchConversations("SeArCh");

    expect(lowerResults.length).toBe(upperResults.length);
    expect(lowerResults.length).toBe(mixedResults.length);
  });

  it("should group results by session", () => {
    const results = database.searchConversations("search");

    const session1 = results.find(r => r.session_id === testSessionId1);
    const session2 = results.find(r => r.session_id === testSessionId2);

    expect(session1).toBeDefined();
    expect(session2).toBeDefined();

    // Session 1 should have more matches (3 messages with "search")
    expect(session1!.matches.length).toBeGreaterThanOrEqual(2);

    // Session 2 should have fewer matches (1 message with "search")
    expect(session2!.matches.length).toBeGreaterThanOrEqual(1);
  });

  it("should include session label (first user message)", () => {
    const results = database.searchConversations("search");

    const session1 = results.find(r => r.session_id === testSessionId1);
    expect(session1).toBeDefined();
    expect(session1!.session_label).toBe("How do I implement a search feature?");
  });

  it("should return empty array for no matches", () => {
    const results = database.searchConversations("nonexistent-query-xyz");
    expect(results).toEqual([]);
  });

  it("should create snippets for long content", () => {
    const longContent = "a".repeat(300);
    const sessionLong = "test-session-long";
    database.recordMessage(sessionLong, userId, "user", "Long test message", undefined, "/test/project");
    database.recordMessage(sessionLong, userId, "assistant", `${longContent} search ${longContent}`, undefined, "/test/project");

    const results = database.searchConversations("search");
    const longResult = results.find(r => r.session_id === sessionLong);

    expect(longResult).toBeDefined();
    expect(longResult!.matches[0].content.length).toBeLessThan(300);
    expect(longResult!.matches[0].content).toContain("search");

    database.archiveSession(sessionLong);
  });

  it("should filter by project path when provided", () => {
    const otherProject = "test-session-other-project";
    database.recordMessage(otherProject, userId, "user", "search in another project", undefined, "/other/project");

    const allResults = database.searchConversations("search");
    const filteredResults = database.searchConversations("search", "/test/project");

    expect(allResults.length).toBeGreaterThan(filteredResults.length);

    const otherProjectResult = filteredResults.find(r => r.session_id === otherProject);
    expect(otherProjectResult).toBeUndefined();

    database.archiveSession(otherProject);
  });

  it("should respect limit parameter", () => {
    // Create many messages
    for (let i = 0; i < 60; i++) {
      database.recordMessage(`limit-session-${i}`, userId, "user", `search message ${i}`, undefined, "/test/project");
    }

    const results = database.searchConversations("search", undefined, 50);
    const totalMatches = results.reduce((acc, r) => acc + r.matches.length, 0);

    expect(totalMatches).toBeLessThanOrEqual(50);

    // Clean up
    for (let i = 0; i < 60; i++) {
      database.archiveSession(`limit-session-${i}`);
    }
  });

  it("should include role and timestamp in matches", () => {
    const results = database.searchConversations("search");
    const session1 = results.find(r => r.session_id === testSessionId1);

    expect(session1).toBeDefined();
    expect(session1!.matches.length).toBeGreaterThan(0);

    const match = session1!.matches[0];
    expect(match.role).toBeDefined();
    expect(['user', 'assistant']).toContain(match.role);
    expect(match.timestamp).toBeDefined();
  });

  it("should not include archived sessions", () => {
    const archivedSession = "test-archived-session";
    database.recordMessage(archivedSession, userId, "user", "archived search query", undefined, "/test/project");
    database.archiveSession(archivedSession);

    const results = database.searchConversations("archived");
    const archivedResult = results.find(r => r.session_id === archivedSession);

    expect(archivedResult).toBeUndefined();
  });

  it("should handle special characters in query", () => {
    const specialSession = "test-special-chars";
    database.recordMessage(specialSession, userId, "user", "Search for $100 or 50% discount?", undefined, "/test/project");

    const results1 = database.searchConversations("$100");
    const results2 = database.searchConversations("50%");

    expect(results1.length).toBeGreaterThan(0);
    expect(results2.length).toBeGreaterThan(0);

    database.archiveSession(specialSession);
  });
});
