import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  isSessionImported,
  recordImportedSession,
  insertImportedConversation,
  insertImportedQueryUsage,
  insertImportedToolUsage,
} from './database.js';

// TypeScript interfaces for JSONL entries
interface JournalEntry {
  type: 'user' | 'assistant' | 'system' | 'summary';
  uuid: string;
  parentUuid?: string;
  timestamp: string;
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  message: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
}

interface ImportResult {
  sessionsScanned: number;
  sessionsImported: number;
  sessionsSkipped: number;
  messagesImported: number;
  queriesImported: number;
  toolsImported: number;
  errors: string[];
}

interface ScannedProject {
  folderName: string;
  projectPath: string;
  sessions: Array<{ filePath: string; sessionId: string }>;
}

// Model pricing in $ per million tokens
// Keys are prefixes — matched against model names using startsWith
const MODEL_PRICING_PREFIXES: Array<{
  prefix: string;
  rates: { input: number; output: number; cacheRead: number; cacheCreation: number };
}> = [
  { prefix: 'claude-opus-4', rates: { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 } },
  { prefix: 'claude-sonnet-4', rates: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 } },
  { prefix: 'claude-haiku-4', rates: { input: 0.8, output: 4.0, cacheRead: 0.08, cacheCreation: 1.0 } },
];

const DEFAULT_PRICING = { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 };

function getModelPricing(model: string): { input: number; output: number; cacheRead: number; cacheCreation: number } {
  const match = MODEL_PRICING_PREFIXES.find((p) => model.startsWith(p.prefix));
  return match?.rates ?? DEFAULT_PRICING;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Converts encoded folder name to filesystem path.
 * Claude Code encodes `/` as `-`:
 * - `-Users-matifuentes-Workspace-ccplus` → `/Users/matifuentes/Workspace/ccplus`
 */
export function decodeFolderPath(folderName: string): string {
  // Replace leading `-` with `/`, then all remaining `-` with `/`
  if (!folderName.startsWith('-')) {
    return folderName;
  }

  const decoded = '/' + folderName.slice(1).replace(/-/g, '/');

  // Check if decoded path exists
  if (fs.existsSync(decoded)) {
    return decoded;
  }

  // Handle ambiguity: try keeping hyphens for segments that don't resolve
  // For now, return decoded path even if it doesn't exist
  // The caller can handle non-existent paths
  return decoded;
}

/**
 * Classify user-type entries to filter out system artifacts and tool results.
 */
export function classifyUserMessage(
  content: string | ContentBlock[]
): 'human' | 'tool_result' | 'system_artifact' | 'skip' {
  // Array content with any tool_result block
  if (Array.isArray(content) && content.some((block) => block.type === 'tool_result')) {
    return 'tool_result';
  }

  const textContent = extractTextContent(content);
  const systemArtifacts = ['<task-notification>', 'Base directory for this skill:', 'This session is being continued'];
  const skipPatterns = ['<command-name>', '<local-command-caveat>', '<local-command-stdout>'];

  if (systemArtifacts.some((p) => textContent.startsWith(p))) return 'system_artifact';
  if (skipPatterns.some((p) => textContent.includes(p))) return 'skip';

  return 'human';
}

/**
 * Extract readable text from content blocks.
 */
export function extractTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => {
      if (block.type === 'text' && block.text) return block.text;
      if (block.type === 'thinking' && block.thinking) return `[Thinking: ${block.thinking}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Extract tool_use blocks from assistant content arrays.
 */
export function extractToolCalls(
  content: string | ContentBlock[]
): Array<{ name: string; input: Record<string, unknown> }> {
  if (!Array.isArray(content)) return [];

  return content
    .filter((block) => block.type === 'tool_use' && block.name)
    .map((block) => ({ name: block.name!, input: block.input ?? {} }));
}

/**
 * Estimate cost based on model and usage.
 */
export function estimateCost(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }
): number {
  const pricing = getModelPricing(model);

  const inputCost = ((usage.input_tokens ?? 0) * pricing.input) / 1_000_000;
  const outputCost = ((usage.output_tokens ?? 0) * pricing.output) / 1_000_000;
  const cacheCost = ((usage.cache_creation_input_tokens ?? 0) * pricing.cacheCreation) / 1_000_000;
  const cacheReadCost = ((usage.cache_read_input_tokens ?? 0) * pricing.cacheRead) / 1_000_000;

  return inputCost + outputCost + cacheCost + cacheReadCost;
}

/**
 * Scan ~/.claude/projects/ for historical session JSONL files.
 * Excludes subagents/ subdirectories.
 */
export function scanClaudeProjects(): ScannedProject[] {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

  if (!fs.existsSync(claudeProjectsDir)) {
    return [];
  }

  const projects: ScannedProject[] = [];
  const folderNames = fs.readdirSync(claudeProjectsDir);

  for (const folderName of folderNames) {
    const folderPath = path.join(claudeProjectsDir, folderName);
    const stat = fs.statSync(folderPath);

    if (!stat.isDirectory()) {
      continue;
    }

    const projectPath = decodeFolderPath(folderName);
    const sessions: Array<{ filePath: string; sessionId: string }> = [];

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const fileStat = fs.statSync(filePath);

      // Skip directories (including subagents/)
      if (fileStat.isDirectory()) {
        continue;
      }

      // Match UUID pattern before .jsonl
      if (file.endsWith('.jsonl')) {
        const sessionId = file.replace('.jsonl', '');
        // Basic UUID validation (8-4-4-4-12 hex pattern)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
          sessions.push({ filePath, sessionId });
        }
      }
    }

    if (sessions.length > 0) {
      projects.push({ folderName, projectPath, sessions });
    }
  }

  return projects;
}

/**
 * Main orchestrator: imports all scanned sessions into cc+ database.
 */
export function importSessions(): ImportResult {
  const result: ImportResult = {
    sessionsScanned: 0,
    sessionsImported: 0,
    sessionsSkipped: 0,
    messagesImported: 0,
    queriesImported: 0,
    toolsImported: 0,
    errors: [],
  };

  const projects = scanClaudeProjects();

  for (const project of projects) {
    for (const session of project.sessions) {
      result.sessionsScanned++;

      const ccplusSessionId = `imported_${session.sessionId}`;

      // Skip if already imported
      if (isSessionImported(session.sessionId)) {
        result.sessionsSkipped++;
        continue;
      }

      try {
        // Check file size
        const stat = fs.statSync(session.filePath);
        if (stat.size > MAX_FILE_SIZE) {
          result.errors.push(
            `Skipped ${session.sessionId}: file size ${stat.size} exceeds 100MB limit`
          );
          result.sessionsSkipped++;
          continue;
        }

        // Read and parse JSONL file
        const fileContent = fs.readFileSync(session.filePath, 'utf-8');
        const lines = fileContent.split('\n').filter((line) => line.trim().length > 0);

        let sessionMessagesCount = 0;
        let sessionQueriesCount = 0;
        let sessionToolsCount = 0;
        let firstTimestamp = '';
        let lastTimestamp = '';

        for (const line of lines) {
          let entry: JournalEntry;
          try {
            entry = JSON.parse(line) as JournalEntry;
          } catch {
            // Skip malformed JSON lines
            continue;
          }

          // Skip meta entries
          if (entry.isMeta) {
            continue;
          }

          // Only process user and assistant messages
          if (entry.type !== 'user' && entry.type !== 'assistant') {
            continue;
          }

          // Track timestamps
          if (!firstTimestamp || entry.timestamp < firstTimestamp) {
            firstTimestamp = entry.timestamp;
          }
          if (!lastTimestamp || entry.timestamp > lastTimestamp) {
            lastTimestamp = entry.timestamp;
          }

          if (entry.type === 'user') {
            const classification = classifyUserMessage(entry.message.content);

            // Only insert 'human' messages
            if (classification === 'human') {
              const textContent = extractTextContent(entry.message.content);
              insertImportedConversation({
                sessionId: ccplusSessionId,
                role: 'user',
                content: textContent,
                timestamp: entry.timestamp,
                projectPath: project.projectPath,
              });
              sessionMessagesCount++;
            }
          } else if (entry.type === 'assistant') {
            const textContent = extractTextContent(entry.message.content);

            insertImportedConversation({
              sessionId: ccplusSessionId,
              role: 'assistant',
              content: textContent,
              timestamp: entry.timestamp,
              projectPath: project.projectPath,
            });
            sessionMessagesCount++;

            // Record query usage
            if (entry.message.usage) {
              const usage = entry.message.usage;
              const model = entry.message.model ?? 'unknown';
              const cost = estimateCost(model, usage);

              insertImportedQueryUsage({
                sessionId: ccplusSessionId,
                model,
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
                cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
                cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
                costUsd: cost,
                durationMs: 0, // Not available in JSONL
                projectPath: project.projectPath,
                timestamp: entry.timestamp,
              });
              sessionQueriesCount++;
            }

            // Extract and record tool calls
            const toolCalls = extractToolCalls(entry.message.content);
            for (const toolCall of toolCalls) {
              insertImportedToolUsage({
                sessionId: ccplusSessionId,
                toolName: toolCall.name,
                timestamp: entry.timestamp,
                success: true, // Assume success if tool_use block exists
              });
              sessionToolsCount++;
            }
          }
        }

        // Record import completion
        recordImportedSession({
          jsonlSessionId: session.sessionId,
          projectPath: project.projectPath,
          messageCount: sessionMessagesCount,
          queryCount: sessionQueriesCount,
          toolCount: sessionToolsCount,
          firstTimestamp: firstTimestamp || new Date().toISOString(),
          lastTimestamp: lastTimestamp || new Date().toISOString(),
        });

        result.sessionsImported++;
        result.messagesImported += sessionMessagesCount;
        result.queriesImported += sessionQueriesCount;
        result.toolsImported += sessionToolsCount;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Failed to import ${session.sessionId}: ${errorMsg}`);
        result.sessionsSkipped++;
      }
    }
  }

  return result;
}
