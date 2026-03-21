import { getDb } from "./connection.js";

export function searchConversations(query: string, projectPath?: string, limit: number = 50): Record<string, unknown>[] {
  const d = getDb();
  const searchPattern = `%${query}%`;
  const projectFilter = projectPath ? "AND project_path = ?" : "";
  const params: unknown[] = projectPath ? [searchPattern, projectPath, limit] : [searchPattern, limit];

  const rows = d.prepare(`
    WITH session_matches AS (
      SELECT
        session_id,
        content,
        role,
        timestamp,
        (SELECT content FROM conversations c2
         WHERE c2.session_id = c1.session_id AND c2.role = 'user'
         ORDER BY c2.timestamp ASC LIMIT 1) as session_label
      FROM conversations c1
      WHERE content LIKE ?
      AND (archived = 0 OR archived IS NULL)
      ${projectFilter}
      ORDER BY timestamp DESC
    )
    SELECT * FROM session_matches
    LIMIT ?
  `).all(...params) as Array<{
    session_id: string;
    content: string;
    role: string;
    timestamp: string;
    session_label: string;
  }>;

  // Group by session_id and create snippets
  const sessionMap = new Map<string, {
    session_id: string;
    session_label: string;
    matches: Array<{ content: string; role: string; timestamp: string }>;
  }>();

  for (const row of rows) {
    if (!sessionMap.has(row.session_id)) {
      sessionMap.set(row.session_id, {
        session_id: row.session_id,
        session_label: row.session_label || "Untitled session",
        matches: [],
      });
    }

    // Create snippet with context around the match
    const content = row.content;
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerContent.indexOf(lowerQuery);

    let snippet = content;
    if (matchIndex !== -1 && content.length > 200) {
      const contextStart = Math.max(0, matchIndex - 50);
      const contextEnd = Math.min(content.length, matchIndex + query.length + 150);
      snippet = (contextStart > 0 ? "..." : "") +
                content.slice(contextStart, contextEnd) +
                (contextEnd < content.length ? "..." : "");
    } else if (content.length > 200) {
      snippet = content.slice(0, 200) + "...";
    }

    sessionMap.get(row.session_id)!.matches.push({
      content: snippet,
      role: row.role,
      timestamp: row.timestamp,
    });
  }

  return Array.from(sessionMap.values());
}

export function semanticSearchConversations(query: string, limit: number = 20): Array<{
  session_id: string
  role: string
  content: string
  timestamp: string
  rank: number
}> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const d = getDb();
  const stmt = d.prepare(`
    SELECT c.session_id, c.role, c.content, c.timestamp, conversations_fts.rank
    FROM conversations_fts
    JOIN conversations c ON conversations_fts.rowid = c.id
    WHERE conversations_fts MATCH ?
    AND (c.archived = 0 OR c.archived IS NULL)
    ORDER BY conversations_fts.rank
    LIMIT ?
  `);
  return stmt.all(query.trim(), limit) as Array<{
    session_id: string
    role: string
    content: string
    timestamp: string
    rank: number
  }>;
}
