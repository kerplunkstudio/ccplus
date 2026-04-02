/**
 * Captain core memory — a small, always-in-context block of high-signal information
 * that Captain can self-edit via tool calls. Inspired by Letta/MemGPT's tiered memory.
 *
 * Stored as JSON at data/captain-core-memory.json. Injected into every Captain system prompt.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { log } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoreMemoryBlock {
  readonly user: string;      // User preferences, role, communication style (max 800 chars)
  readonly project: string;   // Active project state, current goals, key decisions (max 1200 chars)
  readonly lessons: string;   // Corrections, things learned from failures, patterns to follow/avoid (max 1000 chars)
  readonly updatedAt: string; // ISO timestamp of last update
}

export interface MemoryOpResult {
  readonly success: boolean;
  readonly error?: string;
  readonly block: CoreMemoryBlock;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORE_MEMORY_PATH = path.join(DATA_DIR, 'captain-core-memory.json');

const BLOCK_LIMITS: Readonly<Record<string, number>> = {
  user: 800,
  project: 1200,
  lessons: 1000,
};

const VALID_LABELS = Object.keys(BLOCK_LIMITS) as ReadonlyArray<string>;

const DEFAULT_BLOCK: Omit<CoreMemoryBlock, 'updatedAt'> = {
  user: '',
  project: '',
  lessons: '',
};

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

/**
 * Reads core memory from disk. Returns an empty default block if the file does
 * not exist or cannot be parsed. Synchronous — the file is small JSON.
 */
export function loadCoreMemory(): CoreMemoryBlock {
  if (!existsSync(CORE_MEMORY_PATH)) {
    return { ...DEFAULT_BLOCK, updatedAt: new Date().toISOString() };
  }

  try {
    const raw = readFileSync(CORE_MEMORY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CoreMemoryBlock>;
    return {
      user: parsed.user ?? '',
      project: parsed.project ?? '',
      lessons: parsed.lessons ?? '',
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    log.warn('captain-memory: failed to parse core memory file, using defaults', {
      error: String(error),
    });
    return { ...DEFAULT_BLOCK, updatedAt: new Date().toISOString() };
  }
}

/**
 * Writes core memory to disk. Creates data/ directory if needed. Synchronous.
 */
export function saveCoreMemory(block: CoreMemoryBlock): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(CORE_MEMORY_PATH, JSON.stringify(block, null, 2), 'utf-8');
    log.debug('captain-memory: core memory saved', { updatedAt: block.updatedAt });
  } catch (error) {
    log.error('captain-memory: failed to save core memory', { error: String(error) });
    throw new Error(`Failed to save core memory: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateLabel(label: string): string | null {
  if (!VALID_LABELS.includes(label)) {
    return `Invalid label "${label}". Must be one of: ${VALID_LABELS.join(', ')}`;
  }
  return null;
}

function validateLength(label: string, content: string): string | null {
  const limit = BLOCK_LIMITS[label];
  if (content.length > limit) {
    return `Content exceeds limit for "${label}" (${content.length}/${limit} chars)`;
  }
  return null;
}

function buildUpdatedBlock(current: CoreMemoryBlock, label: string, value: string): CoreMemoryBlock {
  return {
    ...current,
    [label]: value,
    updatedAt: new Date().toISOString(),
  };
}

function failResult(error: string, block: CoreMemoryBlock): MemoryOpResult {
  return { success: false, error, block };
}

// ---------------------------------------------------------------------------
// Public mutation API
// ---------------------------------------------------------------------------

/**
 * Letta-style string replace within a specific block.
 * Finds oldContent exactly once in the block and replaces it with newContent.
 */
export function updateCoreMemoryBlock(
  label: string,
  oldContent: string,
  newContent: string,
): MemoryOpResult {
  const current = loadCoreMemory();

  const labelError = validateLabel(label);
  if (labelError) return failResult(labelError, current);

  const blockValue = current[label as keyof CoreMemoryBlock] as string;
  const occurrences = blockValue.split(oldContent).length - 1;

  if (occurrences === 0) {
    return failResult(`oldContent not found in "${label}" block`, current);
  }
  if (occurrences > 1) {
    return failResult(`oldContent appears ${occurrences} times in "${label}" block — must be unique`, current);
  }

  const updated = blockValue.replace(oldContent, newContent);
  const lengthError = validateLength(label, updated);
  if (lengthError) return failResult(lengthError, current);

  const block = buildUpdatedBlock(current, label, updated);
  saveCoreMemory(block);
  return { success: true, block };
}

/**
 * Appends text to the end of a block.
 * Will fail if the resulting content would exceed the block's char limit.
 */
export function appendCoreMemory(label: string, content: string): MemoryOpResult {
  const current = loadCoreMemory();

  const labelError = validateLabel(label);
  if (labelError) return failResult(labelError, current);

  const blockValue = current[label as keyof CoreMemoryBlock] as string;
  const separator = blockValue.length > 0 ? '\n' : '';
  const updated = blockValue + separator + content;

  const lengthError = validateLength(label, updated);
  if (lengthError) return failResult(lengthError, current);

  const block = buildUpdatedBlock(current, label, updated);
  saveCoreMemory(block);
  return { success: true, block };
}

/**
 * Wholesale replacement of a block's entire content.
 * Use when a full rewrite is needed rather than a targeted edit.
 */
export function rethinkCoreMemory(label: string, newContent: string): MemoryOpResult {
  const current = loadCoreMemory();

  const labelError = validateLabel(label);
  if (labelError) return failResult(labelError, current);

  const lengthError = validateLength(label, newContent);
  if (lengthError) return failResult(lengthError, current);

  const block = buildUpdatedBlock(current, label, newContent);
  saveCoreMemory(block);
  return { success: true, block };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders core memory as an XML block suitable for injection into the Captain
 * system prompt. Empty blocks are included so Captain knows what it can fill.
 */
export function renderCoreMemory(): string {
  const block = loadCoreMemory();

  const renderSection = (label: string): string => {
    const value = block[label as keyof CoreMemoryBlock] as string;
    const limit = BLOCK_LIMITS[label];
    return `<${label} chars_used="${value.length}" chars_limit="${limit}">\n${escapeXml(value)}\n</${label}>`;
  };

  const sections = VALID_LABELS.map(renderSection).join('\n\n');

  return [
    '<core_memory>',
    'The following is your persistent core memory. You can edit it using memory tools.',
    '',
    sections,
    '',
    `Last updated: ${block.updatedAt}`,
    '</core_memory>',
  ].join('\n');
}
