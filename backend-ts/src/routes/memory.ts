import type { Express, Request, Response } from 'express';
import { searchMemories, deleteMemory, isMemoryAvailable } from '../memory-client.js';
import { getDistillationStats, getRecentDistillations } from '../db/memory-observability.js';
import { recordMemoryAccess } from '../memory-promotion.js';
import { log } from '../logger.js';

interface ParsedMemory {
  hash: string;
  title: string;
  content: string;
  preview: string;
  tags: string[];
  created: string | null;
}

/**
 * Parse the raw text response from memory_search into structured memory objects.
 * The mcp-memory-service returns formatted text with sections separated by ---
 */
function parseMemoryText(text: string): ParsedMemory[] {
  if (!text || text.trim() === '') {
    return [];
  }

  const memories: ParsedMemory[] = [];
  // Split by horizontal rule separators
  const sections = text.split(/\n---+\n/);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || trimmed.startsWith('#') && !trimmed.includes('\n')) {
      continue;
    }

    const lines = trimmed.split('\n');
    let title = '';
    let hash = '';
    let created: string | null = null;
    const tags: string[] = [];
    const contentLines: string[] = [];
    let inContent = false;

    for (const line of lines) {
      const hashMatch = line.match(/\*\*Hash:\*\*\s*(.+)/i) || line.match(/^Hash:\s*(.+)/i);
      const tagsMatch = line.match(/\*\*Tags:\*\*\s*(.+)/i) || line.match(/^Tags:\s*(.+)/i);
      const createdMatch = line.match(/\*\*Created:\*\*\s*(.+)/i) || line.match(/^Created:\s*(.+)/i);
      const titleMatch = line.match(/^##\s+(.+)/);

      if (titleMatch) {
        title = titleMatch[1].trim();
        inContent = true;
      } else if (hashMatch) {
        hash = hashMatch[1].trim();
        inContent = false;
      } else if (tagsMatch) {
        const tagStr = tagsMatch[1].trim();
        tags.push(...tagStr.split(',').map(t => t.trim()).filter(Boolean));
        inContent = false;
      } else if (createdMatch) {
        created = createdMatch[1].trim();
        inContent = false;
      } else if (inContent && line.trim() !== '') {
        contentLines.push(line);
      }
    }

    // Fall back to first non-empty line as title
    if (!title && contentLines.length > 0) {
      title = contentLines[0].substring(0, 80);
    }

    const content = contentLines.join('\n').trim();
    const preview = content.substring(0, 200);

    if (content || title) {
      memories.push({
        hash: hash || `${Date.now()}-${memories.length}`,
        title: title || 'Untitled',
        content,
        preview,
        tags,
        created,
      });
    }
  }

  return memories;
}

const VALID_MODES = new Set(['semantic', 'exact', 'hybrid']);

export function createMemoryRoutes(app: Express): void {
  // GET /api/memory/search?q=&limit=10&mode=semantic
  app.get('/api/memory/search', async (req: Request, res: Response) => {
    const { q = '', limit: limitStr, mode } = req.query;

    if (typeof q !== 'string') {
      res.status(400).json({ success: false, error: 'q must be a string' });
      return;
    }

    const effectiveMode = typeof mode === 'string' && VALID_MODES.has(mode) ? mode : 'semantic';

    let parsedLimit = 20;
    if (limitStr !== undefined) {
      const n = parseInt(String(limitStr), 10);
      if (isNaN(n) || n < 1 || n > 100) {
        res.status(400).json({ success: false, error: 'limit must be between 1 and 100' });
        return;
      }
      parsedLimit = n;
    }

    if (!isMemoryAvailable()) {
      res.json({ success: true, data: [], meta: { total: 0, available: false } });
      return;
    }

    try {
      const rawText = await searchMemories(q, parsedLimit, undefined, effectiveMode);
      const memories = parseMemoryText(rawText);

      // Track access for retrieved memories (best-effort, never blocks search)
      for (const mem of memories) {
        try {
          recordMemoryAccess(mem.hash, mem.preview, mem.tags.join(','));
        } catch {
          // Never block search on tracking failure
        }
      }

      res.json({
        success: true,
        data: memories,
        meta: { total: memories.length, query: q, mode: effectiveMode, available: true },
      });
    } catch (error) {
      log.error('Memory search route error', { error: String(error) });
      res.status(500).json({ success: false, error: 'Memory search failed' });
    }
  });

  // GET /api/memory/health
  app.get('/api/memory/health', (_req: Request, res: Response) => {
    try {
      const stats = getDistillationStats(24);
      const recent = getRecentDistillations(20);
      const successRate = stats.total > 0 ? Math.round((stats.successes / stats.total) * 100) : 0;

      res.json({
        success: true,
        data: {
          available: isMemoryAvailable(),
          stats: {
            ...stats,
            successRate,
          },
          recent,
        },
      });
    } catch (error) {
      log.error('Memory health route error', { error: String(error) });
      res.status(500).json({ success: false, error: 'Failed to get memory health' });
    }
  });

  // DELETE /api/memory/:hash
  app.delete('/api/memory/:hash', async (req: Request, res: Response) => {
    const { hash } = req.params;

    if (!hash || typeof hash !== 'string' || hash.trim() === '') {
      res.status(400).json({ success: false, error: 'hash is required' });
      return;
    }

    if (hash.length > 256) {
      res.status(400).json({ success: false, error: 'hash too long' });
      return;
    }

    try {
      const deleted = await deleteMemory(hash);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, error: 'Memory not found or delete failed' });
      }
    } catch (error) {
      log.error('Memory delete route error', { error: String(error), hash });
      res.status(500).json({ success: false, error: 'Failed to delete memory' });
    }
  });
}
