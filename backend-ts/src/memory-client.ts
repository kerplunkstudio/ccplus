// Lightweight MCP client for the memory server
// Spawns memory binary as child process, communicates via JSON-RPC over stdio

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { log } from './logger.js';
import { getUserMcpServers } from './mcp-config.js';
import { MEMORY_SEARCH_TIMEOUT_MS, MEMORY_INIT_TIMEOUT_MS } from './config.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MemoryServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// Module state
let memoryProcess: ChildProcess | null = null;
let memoryConfig: MemoryServerConfig | null = null;
let available = false;
let initialized = false;
let initPromise: Promise<boolean> | null = null;
let requestId = 0;
let pendingRequests = new Map<number, PendingRequest>();
let buffer = '';

// Circuit breaker state
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60000;

function isCircuitOpen(): boolean {
  if (consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
  if (Date.now() > circuitOpenUntil) {
    // Allow one retry after cooldown
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    log.warn('Memory circuit breaker opened', {
      failures: consecutiveFailures,
      cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
    });
  }
}

/**
 * Load memory server config from ~/.claude.json
 */
function loadMemoryConfig(): MemoryServerConfig | null {
  try {
    const servers = getUserMcpServers();
    const memoryServer = servers.find((s) => s.name === 'memory');

    if (!memoryServer || memoryServer.config.type !== 'stdio') {
      log.warn('Memory server not found in ~/.claude.json or not stdio type');
      return null;
    }

    const config = memoryServer.config;
    if (!config.command) {
      log.warn('Memory server missing command');
      return null;
    }

    // Verify binary exists
    if (!existsSync(config.command)) {
      log.warn('Memory server binary not found', { path: config.command });
      return null;
    }

    return {
      command: config.command,
      args: config.args || [],
      env: config.env || {},
    };
  } catch (error) {
    log.error('Failed to load memory server config', { error: String(error) });
    return null;
  }
}

/**
 * Handle incoming JSON-RPC messages from memory server
 */
function handleMessage(line: string): void {
  try {
    const message = JSON.parse(line) as JsonRpcResponse;

    if (message.id === undefined || message.id === null) {
      // Notification or error without ID
      return;
    }

    const pending = pendingRequests.get(message.id);
    if (!pending) {
      log.debug('Received response for unknown request ID', { id: message.id });
      return;
    }

    clearTimeout(pending.timer);
    pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(new Error(`MCP error: ${message.error.message}`));
    } else {
      pending.resolve(message.result);
    }
  } catch (error) {
    log.error('Failed to parse JSON-RPC message', { error: String(error), line });
  }
}

/**
 * Process stdout data from memory server
 */
function handleStdout(data: Buffer): void {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (line.trim()) {
      handleMessage(line);
    }
  }
}

/**
 * Spawn memory server process
 */
function spawnMemoryProcess(): boolean {
  if (memoryProcess) {
    return true;
  }

  if (!memoryConfig) {
    memoryConfig = loadMemoryConfig();
    if (!memoryConfig) {
      available = false;
      return false;
    }
  }

  try {
    const env = {
      ...process.env,
      ...memoryConfig.env,
    };

    memoryProcess = spawn(memoryConfig.command, memoryConfig.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    memoryProcess.stdout?.on('data', handleStdout);

    memoryProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        log.debug('Memory server stderr', { message: msg });
      }
    });

    memoryProcess.on('error', (error) => {
      log.error('Memory server process error', { error: String(error) });
      available = false;
      memoryProcess = null;
      initialized = false;

      // Reject all pending requests
      for (const [id, pending] of pendingRequests.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Memory server process crashed'));
        pendingRequests.delete(id);
      }
    });

    memoryProcess.on('exit', (code, signal) => {
      log.info('Memory server process exited', { code, signal });
      memoryProcess = null;
      initialized = false;

      // Reject all pending requests
      for (const [id, pending] of pendingRequests.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Memory server process exited'));
        pendingRequests.delete(id);
      }
    });

    available = true;
    return true;
  } catch (error) {
    log.error('Failed to spawn memory server process', { error: String(error) });
    available = false;
    memoryProcess = null;
    return false;
  }
}

/**
 * Send JSON-RPC request to memory server
 */
async function sendRequest(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
  if (!memoryProcess || !memoryProcess.stdin) {
    throw new Error('Memory server process not running');
  }

  const id = ++requestId;
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };

  return new Promise((resolve, reject) => {
    const effectiveTimeout = timeoutMs ?? MEMORY_SEARCH_TIMEOUT_MS;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Memory server request timeout after ${effectiveTimeout}ms`));
    }, effectiveTimeout);

    pendingRequests.set(id, { resolve, reject, timer });

    const message = JSON.stringify(request) + '\n';
    memoryProcess!.stdin!.write(message, (error) => {
      if (error) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(new Error(`Failed to write to memory server: ${error.message}`));
      }
    });
  });
}

/**
 * Initialize memory server connection (internal implementation)
 */
async function doInitialize(): Promise<boolean> {
  if (!spawnMemoryProcess()) {
    initPromise = null;
    return false;
  }

  try {
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'ccplus',
        version: '1.0.0',
      },
    }, MEMORY_INIT_TIMEOUT_MS);

    initialized = true;
    initPromise = null;
    log.info('Memory server initialized');
    return true;
  } catch (error) {
    log.error('Failed to initialize memory server', { error: String(error) });
    available = false;
    initPromise = null;
    shutdownMemoryClient();
    return false;
  }
}

/**
 * Initialize memory server connection
 */
async function initialize(): Promise<boolean> {
  if (initialized) {
    return true;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = doInitialize();
  return initPromise;
}

/**
 * Search memories using semantic search
 * Returns the raw text from the MCP response (human-readable format)
 */
export async function searchMemories(query: string, limit?: number, tags?: string): Promise<string> {
  if (isCircuitOpen()) {
    log.debug('Memory circuit breaker is open, skipping search');
    return '';
  }

  if (!available && !memoryConfig) {
    memoryConfig = loadMemoryConfig();
    if (!memoryConfig) {
      return '';
    }
  }

  try {
    if (!initialized) {
      const success = await initialize();
      if (!success) {
        recordFailure();
        return '';
      }
    }

    const effectiveLimit = limit || 5;
    const args: Record<string, unknown> = {
      query,
      limit: effectiveLimit,
    };
    if (tags) {
      args.tags = tags;
    }

    // Run semantic search
    const response = await sendRequest('tools/call', {
      name: 'memory_search',
      arguments: args,
    });

    let semanticText = '';
    // MCP tools/call response format: { content: [...], isError: false }
    if (typeof response === 'object' && response !== null && 'content' in response) {
      const content = (response as { content: unknown[] }).content;
      if (Array.isArray(content) && content.length > 0) {
        const firstItem = content[0];
        if (typeof firstItem === 'object' && firstItem !== null && 'text' in firstItem) {
          semanticText = (firstItem as { text: string }).text;
        }
      }
    }

    // Log observability data
    if (semanticText) {
      const resultCount = semanticText.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---')).length;
      log.debug('Memory search', {
        query: query.substring(0, 50),
        resultCount,
      });
    }

    recordSuccess();
    return semanticText;
  } catch (error) {
    log.error('Memory search failed', { error: String(error), query });
    recordFailure();
    return '';
  }
}

/**
 * Store a new memory with tags and metadata
 */
export async function storeMemory(
  content: string,
  tags: string,
  metadata?: Record<string, string>
): Promise<string | null> {
  if (isCircuitOpen()) {
    log.debug('Memory circuit breaker is open, skipping store');
    return null;
  }

  if (!available && !memoryConfig) {
    memoryConfig = loadMemoryConfig();
    if (!memoryConfig) {
      return null;
    }
  }

  try {
    if (!initialized) {
      const success = await initialize();
      if (!success) {
        return null;
      }
    }

    const mergedMetadata = {
      tags,
      ...metadata,
    };

    const response = await sendRequest('tools/call', {
      name: 'memory_store',
      arguments: {
        content,
        metadata: mergedMetadata,
      },
    });

    // MCP tools/call response format: { content: [...], isError: false }
    if (typeof response === 'object' && response !== null && 'content' in response) {
      const contentArray = (response as { content: unknown[] }).content;
      if (Array.isArray(contentArray) && contentArray.length > 0) {
        const firstItem = contentArray[0];
        if (typeof firstItem === 'object' && firstItem !== null && 'text' in firstItem) {
          recordSuccess();
          return (firstItem as { text: string }).text;
        }
      }
    }

    recordSuccess();
    return null;
  } catch (error) {
    log.error('Memory store failed', { error: String(error) });
    recordFailure();
    return null;
  }
}

/**
 * Shutdown memory server process
 */
export function shutdownMemoryClient(): void {
  if (memoryProcess) {
    try {
      memoryProcess.kill('SIGTERM');
    } catch (error) {
      log.error('Failed to kill memory server process', { error: String(error) });
    }
    memoryProcess = null;
  }

  initialized = false;
  available = false;
  memoryConfig = null;
  initPromise = null;
  buffer = '';

  // Reset circuit breaker
  consecutiveFailures = 0;
  circuitOpenUntil = 0;

  // Clear all pending requests
  for (const [id, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Memory client shutdown'));
    pendingRequests.delete(id);
  }
}

/**
 * Check if memory server is available
 */
export function isMemoryAvailable(): boolean {
  if (!memoryConfig) {
    memoryConfig = loadMemoryConfig();
  }
  return memoryConfig !== null;
}
