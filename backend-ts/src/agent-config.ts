import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, statSync } from 'fs';
import { watch } from 'fs';
import { homedir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { log } from './logger.js';
import { PROJECT_ROOT } from './config.js';

export const FileAccessPolicySchema = z.object({
  allowedPaths: z.array(z.string()).optional(),
  deniedPaths: z.array(z.string()).optional(),
});

export const SecurityConfigSchema = z.object({
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  fileAccess: FileAccessPolicySchema.optional(),
});

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  recentDays: z.number().int().min(0).default(7),
  maxContextChars: z.number().int().min(0).default(10000),
});

export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
  maxTurns: z.number().int().min(1).max(10000).optional(),
  personality: z.string().optional(),
  security: SecurityConfigSchema.optional(),
  memory: MemoryConfigSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export type ResolvedAgent = AgentConfig & {
  id: string;
  soulContent?: string;
  dirPath: string;
};

function getGlobalAgentsDir(): string {
  return path.join(homedir(), '.ccplus', 'agents');
}

function getProjectAgentsDir(workspacePath: string): string {
  return path.join(workspacePath, '.ccplus', 'agents');
}

/**
 * Scan a directory for agent subdirs, parse agent.yaml + SOUL.md
 * Invalid YAML/schema = log warning and skip (never fatal)
 */
export async function loadAgentsFromDir(dir: string): Promise<ResolvedAgent[]> {
  if (!existsSync(dir)) return [];

  const agents: ResolvedAgent[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    log.warn('Failed to read agents directory', { dir, error: String(err) });
    return [];
  }

  for (const entry of entries) {
    const agentDir = path.join(dir, entry);
    try {
      if (!statSync(agentDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const yamlPath = path.join(agentDir, 'agent.yaml');
    if (!existsSync(yamlPath)) continue;

    try {
      const raw = readFileSync(yamlPath, 'utf-8');
      const parsed = yaml.load(raw);
      const result = AgentConfigSchema.safeParse(parsed);

      if (!result.success) {
        log.warn('Invalid agent.yaml schema', { agentDir, issues: result.error.issues });
        continue;
      }

      const soulPath = path.join(agentDir, 'SOUL.md');
      const soulContent = existsSync(soulPath)
        ? readFileSync(soulPath, 'utf-8')
        : undefined;

      agents.push({
        ...result.data,
        id: entry,
        soulContent,
        dirPath: agentDir,
      });
    } catch (err) {
      log.warn('Failed to parse agent config', { agentDir, error: String(err) });
    }
  }

  return agents;
}

/**
 * Merge built-in (.ccplus/agents/) + global (~/.ccplus/agents/) + project (.ccplus/agents/) agents.
 * Priority: built-in < global < project (project wins on name collision).
 */
export async function loadAllAgents(workspacePath: string): Promise<ResolvedAgent[]> {
  const builtInDir = path.join(PROJECT_ROOT, '.ccplus', 'agents');
  const [builtInAgents, globalAgents, projectAgents] = await Promise.all([
    loadAgentsFromDir(builtInDir),
    loadAgentsFromDir(getGlobalAgentsDir()),
    loadAgentsFromDir(getProjectAgentsDir(workspacePath)),
  ]);

  // Build map by id — built-in < global < project priority
  const agentMap = new Map<string, ResolvedAgent>();
  for (const agent of builtInAgents) {
    agentMap.set(agent.id, agent);
  }
  for (const agent of globalAgents) {
    agentMap.set(agent.id, agent);
  }
  for (const agent of projectAgents) {
    agentMap.set(agent.id, agent);
  }

  return [...agentMap.values()];
}

export const SAFE_AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Get single agent by id (checks project dir first, then global, then built-in)
 */
export async function getAgent(workspacePath: string, id: string): Promise<ResolvedAgent | null> {
  if (!SAFE_AGENT_ID_RE.test(id)) return null;

  const dirs = [
    getProjectAgentsDir(workspacePath),
    getGlobalAgentsDir(),
    path.join(PROJECT_ROOT, '.ccplus', 'agents'),
  ];

  for (const baseDir of dirs) {
    const agentDir = path.join(baseDir, id);
    const yamlPath = path.join(agentDir, 'agent.yaml');
    if (!existsSync(yamlPath)) continue;

    try {
      const raw = readFileSync(yamlPath, 'utf-8');
      const parsed = yaml.load(raw);
      const result = AgentConfigSchema.safeParse(parsed);
      if (!result.success) {
        log.warn('Invalid agent.yaml schema', { agentDir, issues: result.error.issues });
        continue;
      }

      const soulPath = path.join(agentDir, 'SOUL.md');
      const soulContent = existsSync(soulPath) ? readFileSync(soulPath, 'utf-8') : undefined;

      return { ...result.data, id, soulContent, dirPath: agentDir };
    } catch (err) {
      log.warn('Failed to parse agent config', { agentDir, error: String(err) });
    }
  }

  return null;
}

/**
 * Watch agent directories for hot reload
 */
export function watchAgentDirs(workspacePath: string, onChange: () => void): () => void {
  const dirs = [
    path.join(PROJECT_ROOT, '.ccplus', 'agents'),
    getGlobalAgentsDir(),
    getProjectAgentsDir(workspacePath),
  ];
  const watchers: ReturnType<typeof watch>[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const watcher = watch(dir, { recursive: true }, () => onChange());
      watchers.push(watcher);
    } catch (err) {
      log.warn('Failed to watch agent directory', { dir, error: String(err) });
    }
  }

  return () => {
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
  };
}

/**
 * Write agent config to disk (create or update)
 */
export async function writeAgent(
  workspacePath: string,
  id: string,
  config: AgentConfig,
  soulContent?: string,
  scope: 'project' | 'global' = 'project',
): Promise<ResolvedAgent> {
  if (!SAFE_AGENT_ID_RE.test(id)) throw new Error(`Invalid agent id: ${id}`);

  const baseDir = scope === 'project'
    ? getProjectAgentsDir(workspacePath)
    : getGlobalAgentsDir();

  const agentDir = path.join(baseDir, id);
  mkdirSync(agentDir, { recursive: true });

  const yamlContent = yaml.dump(config);
  writeFileSync(path.join(agentDir, 'agent.yaml'), yamlContent, 'utf-8');

  if (soulContent !== undefined) {
    writeFileSync(path.join(agentDir, 'SOUL.md'), soulContent, 'utf-8');
  }

  return {
    ...config,
    id,
    soulContent: soulContent ?? (existsSync(path.join(agentDir, 'SOUL.md'))
      ? readFileSync(path.join(agentDir, 'SOUL.md'), 'utf-8')
      : undefined),
    dirPath: agentDir,
  };
}

/**
 * Delete agent directory
 */
export async function deleteAgent(workspacePath: string, id: string): Promise<boolean> {
  if (!SAFE_AGENT_ID_RE.test(id)) return false;

  // Try project dir first, then global
  const dirs = [
    path.join(getProjectAgentsDir(workspacePath), id),
    path.join(getGlobalAgentsDir(), id),
  ];

  for (const agentDir of dirs) {
    if (existsSync(agentDir)) {
      rmSync(agentDir, { recursive: true, force: true });
      return true;
    }
  }

  return false;
}

/**
 * Resolve short model name to full SDK model ID
 */
export function resolveAgentModel(shortModel: 'sonnet' | 'opus' | 'haiku'): string {
  const map: Record<string, string> = {
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6',
    haiku: 'claude-haiku-4-5-20251001',
  };
  return map[shortModel] ?? 'claude-sonnet-4-6';
}
