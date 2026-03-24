import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock logger
vi.mock('../logger.js', () => ({
  log: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  loadAgentsFromDir,
  resolveAgentModel,
} from '../agent-config.js';

describe('agent-config', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `agent-config-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  });

  describe('loadAgentsFromDir', () => {
    it('returns empty array for non-existent directory', async () => {
      const result = await loadAgentsFromDir(path.join(testDir, 'nonexistent'));
      expect(result).toEqual([]);
    });

    it('parses valid agent.yaml', async () => {
      const agentDir = path.join(testDir, 'my-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'agent.yaml'), `
name: My Agent
description: A test agent
model: sonnet
maxTurns: 10
personality: Be helpful and concise.
`);

      const result = await loadAgentsFromDir(testDir);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('my-agent');
      expect(result[0].name).toBe('My Agent');
      expect(result[0].model).toBe('sonnet');
      expect(result[0].maxTurns).toBe(10);
      expect(result[0].personality).toBe('Be helpful and concise.');
      expect(result[0].dirPath).toBe(agentDir);
    });

    it('loads SOUL.md content when present', async () => {
      const agentDir = path.join(testDir, 'soul-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'agent.yaml'), 'name: Soul Agent\n');
      fs.writeFileSync(path.join(agentDir, 'SOUL.md'), '# My Soul\nI am a helpful agent.');

      const result = await loadAgentsFromDir(testDir);
      expect(result[0].soulContent).toBe('# My Soul\nI am a helpful agent.');
    });

    it('skips invalid YAML gracefully', async () => {
      const agentDir = path.join(testDir, 'bad-agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'agent.yaml'), '{ invalid yaml: [unclosed');

      const result = await loadAgentsFromDir(testDir);
      expect(result).toHaveLength(0);
    });

    it('skips agents with invalid schema', async () => {
      const agentDir = path.join(testDir, 'schema-invalid');
      fs.mkdirSync(agentDir, { recursive: true });
      // Missing required 'name' field
      fs.writeFileSync(path.join(agentDir, 'agent.yaml'), 'description: no name here\n');

      const result = await loadAgentsFromDir(testDir);
      expect(result).toHaveLength(0);
    });

    it('skips directories without agent.yaml', async () => {
      const agentDir = path.join(testDir, 'no-yaml');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'other-file.txt'), 'hello');

      const result = await loadAgentsFromDir(testDir);
      expect(result).toHaveLength(0);
    });
  });


  describe('resolveAgentModel', () => {
    it('resolves sonnet to claude-sonnet-4-6', () => {
      expect(resolveAgentModel('sonnet')).toBe('claude-sonnet-4-6');
    });

    it('resolves opus to claude-opus-4-6', () => {
      expect(resolveAgentModel('opus')).toBe('claude-opus-4-6');
    });

    it('resolves haiku to claude-haiku-4-5-20251001', () => {
      expect(resolveAgentModel('haiku')).toBe('claude-haiku-4-5-20251001');
    });
  });
});
