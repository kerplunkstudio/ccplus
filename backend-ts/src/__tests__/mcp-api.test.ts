import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAllMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from '../mcp-config.js';

describe('MCP API Integration', () => {
  const testDir = path.join(os.tmpdir(), `mcp-api-test-${Date.now()}`);
  const testClaudeJsonPath = path.join(testDir, '.claude.json');
  const testProjectPath = path.join(testDir, 'test-project');
  const testMcpJsonPath = path.join(testProjectPath, '.mcp.json');

  let originalHomeDir: string;

  beforeEach(() => {
    // Create test directories
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(testProjectPath, { recursive: true });

    // Mock homedir
    originalHomeDir = os.homedir();
    vi.spyOn(os, 'homedir').mockReturnValue(testDir);
  });

  afterEach(() => {
    // Restore original homedir
    vi.restoreAllMocks();

    // Clean up test files
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('List MCP Servers', () => {
    it('should return empty array when no servers configured', () => {
      const servers = getAllMcpServers();
      expect(servers).toEqual([]);
    });

    it('should return user servers from .claude.json', () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(config), 'utf-8');

      const servers = getAllMcpServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('test-server');
      expect(servers[0].scope).toBe('user');
    });

    it('should return merged user and project servers when projectPath is provided', () => {
      const claudeConfig = {
        mcpServers: {
          'user-server': {
            command: 'node',
            args: ['user.js'],
          },
        },
      };
      const mcpConfig = {
        mcpServers: {
          'project-server': {
            command: 'python',
            args: ['project.py'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(claudeConfig), 'utf-8');
      fs.writeFileSync(testMcpJsonPath, JSON.stringify(mcpConfig), 'utf-8');

      const servers = getAllMcpServers(testProjectPath);
      expect(servers).toHaveLength(2);
      const names = servers.map(s => s.name).sort();
      expect(names).toEqual(['project-server', 'user-server']);
    });
  });

  describe('Add MCP Servers', () => {
    it('should add a user-scoped server', () => {
      const config: McpServerConfig = {
        command: 'node',
        args: ['new-server.js'],
      };

      addMcpServer('new-server', config, 'user');

      // Verify it was added
      const claudeJson = JSON.parse(fs.readFileSync(testClaudeJsonPath, 'utf-8'));
      expect(claudeJson.mcpServers['new-server']).toBeDefined();
      expect(claudeJson.mcpServers['new-server'].command).toBe('node');
    });

    it('should add a project-scoped server', () => {
      const config: McpServerConfig = {
        command: 'python',
        args: ['server.py'],
      };

      addMcpServer('project-server', config, 'project', testProjectPath);

      // Verify it was added
      const mcpJson = JSON.parse(fs.readFileSync(testMcpJsonPath, 'utf-8'));
      expect(mcpJson.mcpServers['project-server']).toBeDefined();
      expect(mcpJson.mcpServers['project-server'].command).toBe('python');
    });

    it('should update existing server if name already exists', () => {
      const existing = {
        mcpServers: {
          'server': {
            command: 'node',
            args: ['old.js'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(existing), 'utf-8');

      const updated: McpServerConfig = {
        command: 'python',
        args: ['new.py'],
      };
      addMcpServer('server', updated, 'user');

      const claudeJson = JSON.parse(fs.readFileSync(testClaudeJsonPath, 'utf-8'));
      expect(claudeJson.mcpServers['server'].command).toBe('python');
    });
  });

  describe('Remove MCP Servers', () => {
    it('should remove a user-scoped server', () => {
      // Add a server first
      const config = {
        mcpServers: {
          'to-remove': {
            command: 'node',
            args: ['server.js'],
          },
          'to-keep': {
            command: 'python',
            args: ['keep.py'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(config), 'utf-8');

      const removed = removeMcpServer('to-remove', 'user');
      expect(removed).toBe(true);

      // Verify it was removed
      const claudeJson = JSON.parse(fs.readFileSync(testClaudeJsonPath, 'utf-8'));
      expect(claudeJson.mcpServers['to-remove']).toBeUndefined();
      expect(claudeJson.mcpServers['to-keep']).toBeDefined();
    });

    it('should return false when server does not exist', () => {
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify({ mcpServers: {} }), 'utf-8');

      const removed = removeMcpServer('nonexistent', 'user');
      expect(removed).toBe(false);
    });

    it('should remove a project-scoped server', () => {
      const config = {
        mcpServers: {
          'project-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      };
      fs.writeFileSync(testMcpJsonPath, JSON.stringify(config), 'utf-8');

      const removed = removeMcpServer('project-server', 'project', testProjectPath);
      expect(removed).toBe(true);

      const mcpJson = JSON.parse(fs.readFileSync(testMcpJsonPath, 'utf-8'));
      expect(mcpJson.mcpServers['project-server']).toBeUndefined();
    });
  });
});
