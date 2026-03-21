import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getUserMcpServers,
  getProjectMcpServers,
  getAllMcpServers,
  addMcpServer,
  removeMcpServer,
  buildSdkMcpServers,
  type McpServerConfig,
  type McpServerEntry,
} from '../mcp-config.js';

describe('mcp-config', () => {
  const testDir = path.join(os.tmpdir(), `mcp-config-test-${Date.now()}`);
  const testClaudeJsonPath = path.join(testDir, '.claude.json');
  const testProjectPath = path.join(testDir, 'test-project');
  const testMcpJsonPath = path.join(testProjectPath, '.mcp.json');

  let originalHomeDir: string;

  beforeEach(() => {
    // Create test directories
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(testProjectPath, { recursive: true });

    // Mock homedir to return test directory
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

  describe('getUserMcpServers', () => {
    it('should return empty array when .claude.json does not exist', () => {
      const servers = getUserMcpServers();
      expect(servers).toEqual([]);
    });

    it('should return empty array when mcpServers is not defined', () => {
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify({}), 'utf-8');
      const servers = getUserMcpServers();
      expect(servers).toEqual([]);
    });

    it('should return user MCP servers from .claude.json', () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(config), 'utf-8');

      const servers = getUserMcpServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        name: 'test-server',
        config: {
          command: 'node',
          args: ['server.js'],
        },
        scope: 'user',
        enabled: true,
      });
    });

    it('should handle multiple servers', () => {
      const config = {
        mcpServers: {
          'server-1': {
            command: 'node',
            args: ['server1.js'],
          },
          'server-2': {
            type: 'http' as const,
            url: 'http://localhost:3000',
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(config), 'utf-8');

      const servers = getUserMcpServers();
      expect(servers).toHaveLength(2);
      expect(servers.map(s => s.name).sort()).toEqual(['server-1', 'server-2']);
    });
  });

  describe('getProjectMcpServers', () => {
    it('should return empty array when .mcp.json does not exist', () => {
      const servers = getProjectMcpServers(testProjectPath);
      expect(servers).toEqual([]);
    });

    it('should return project MCP servers from .mcp.json', () => {
      const config = {
        mcpServers: {
          'project-server': {
            command: 'python',
            args: ['server.py'],
          },
        },
      };
      fs.writeFileSync(testMcpJsonPath, JSON.stringify(config), 'utf-8');

      const servers = getProjectMcpServers(testProjectPath);
      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        name: 'project-server',
        config: {
          command: 'python',
          args: ['server.py'],
        },
        scope: 'project',
        enabled: true,
      });
    });
  });

  describe('getAllMcpServers', () => {
    it('should return only user servers when no project path is provided', () => {
      const claudeConfig = {
        mcpServers: {
          'user-server': {
            command: 'node',
            args: ['user.js'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(claudeConfig), 'utf-8');

      const servers = getAllMcpServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('user-server');
      expect(servers[0].scope).toBe('user');
    });

    it('should merge user and project servers', () => {
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

    it('should let project servers override user servers with same name', () => {
      const claudeConfig = {
        mcpServers: {
          'shared-server': {
            command: 'node',
            args: ['user.js'],
          },
        },
      };
      const mcpConfig = {
        mcpServers: {
          'shared-server': {
            command: 'python',
            args: ['project.py'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(claudeConfig), 'utf-8');
      fs.writeFileSync(testMcpJsonPath, JSON.stringify(mcpConfig), 'utf-8');

      const servers = getAllMcpServers(testProjectPath);
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('shared-server');
      expect(servers[0].scope).toBe('project');
      expect(servers[0].config).toEqual({
        command: 'python',
        args: ['project.py'],
      });
    });
  });

  describe('addMcpServer', () => {
    it('should add server to user scope', () => {
      const config: McpServerConfig = {
        command: 'node',
        args: ['new-server.js'],
      };

      addMcpServer('new-server', config, 'user');

      const claudeJson = JSON.parse(fs.readFileSync(testClaudeJsonPath, 'utf-8'));
      expect(claudeJson.mcpServers['new-server']).toEqual(config);
    });

    it('should add server to project scope', () => {
      const config: McpServerConfig = {
        command: 'python',
        args: ['project-server.py'],
      };

      addMcpServer('project-server', config, 'project', testProjectPath);

      const mcpJson = JSON.parse(fs.readFileSync(testMcpJsonPath, 'utf-8'));
      expect(mcpJson.mcpServers['project-server']).toEqual(config);
    });

    it('should preserve existing servers when adding new one', () => {
      const existing = {
        mcpServers: {
          'existing': {
            command: 'node',
            args: ['existing.js'],
          },
        },
      };
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify(existing), 'utf-8');

      const newConfig: McpServerConfig = {
        command: 'node',
        args: ['new.js'],
      };
      addMcpServer('new', newConfig, 'user');

      const claudeJson = JSON.parse(fs.readFileSync(testClaudeJsonPath, 'utf-8'));
      expect(Object.keys(claudeJson.mcpServers).sort()).toEqual(['existing', 'new']);
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
      expect(claudeJson.mcpServers['server']).toEqual(updated);
    });
  });

  describe('removeMcpServer', () => {
    it('should remove server from user scope', () => {
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

      const claudeJson = JSON.parse(fs.readFileSync(testClaudeJsonPath, 'utf-8'));
      expect(claudeJson.mcpServers['to-remove']).toBeUndefined();
      expect(claudeJson.mcpServers['to-keep']).toBeDefined();
    });

    it('should remove server from project scope', () => {
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

    it('should return false when server does not exist', () => {
      fs.writeFileSync(testClaudeJsonPath, JSON.stringify({ mcpServers: {} }), 'utf-8');

      const removed = removeMcpServer('nonexistent', 'user');
      expect(removed).toBe(false);
    });
  });

  describe('buildSdkMcpServers', () => {
    it('should build SDK-compatible config from server entries', () => {
      const servers: McpServerEntry[] = [
        {
          name: 'server-1',
          config: {
            command: 'node',
            args: ['server1.js'],
          },
          scope: 'user',
          enabled: true,
        },
        {
          name: 'server-2',
          config: {
            type: 'http',
            url: 'http://localhost:3000',
          },
          scope: 'project',
          enabled: true,
        },
      ];

      const result = buildSdkMcpServers(servers);
      expect(Object.keys(result)).toEqual(['server-1', 'server-2']);
      expect(result['server-1']).toEqual({
        command: 'node',
        args: ['server1.js'],
      });
    });

    it('should exclude disabled servers', () => {
      const servers: McpServerEntry[] = [
        {
          name: 'enabled',
          config: {
            command: 'node',
            args: ['enabled.js'],
          },
          scope: 'user',
          enabled: true,
        },
        {
          name: 'disabled',
          config: {
            command: 'node',
            args: ['disabled.js'],
          },
          scope: 'user',
          enabled: false,
        },
      ];

      const result = buildSdkMcpServers(servers);
      expect(Object.keys(result)).toEqual(['enabled']);
      expect(result['disabled']).toBeUndefined();
    });

    it('should expand environment variables in command', () => {
      process.env.TEST_VAR = '/test/path';

      const servers: McpServerEntry[] = [
        {
          name: 'server',
          config: {
            command: '${TEST_VAR}/node',
            args: ['${TEST_VAR}/server.js'],
          },
          scope: 'user',
          enabled: true,
        },
      ];

      const result = buildSdkMcpServers(servers);
      expect(result['server'].command).toBe('/test/path/node');
      expect((result['server'] as any).args[0]).toBe('/test/path/server.js');

      delete process.env.TEST_VAR;
    });

    it('should use default values for undefined env vars', () => {
      const servers: McpServerEntry[] = [
        {
          name: 'server',
          config: {
            command: '${UNDEFINED_VAR:-/default/path}/node',
          },
          scope: 'user',
          enabled: true,
        },
      ];

      const result = buildSdkMcpServers(servers);
      expect(result['server'].command).toBe('/default/path/node');
    });

    it('should expand env vars in env field', () => {
      process.env.API_KEY = 'secret-key';

      const servers: McpServerEntry[] = [
        {
          name: 'server',
          config: {
            command: 'node',
            args: ['server.js'],
            env: {
              KEY: '${API_KEY}',
            },
          },
          scope: 'user',
          enabled: true,
        },
      ];

      const result = buildSdkMcpServers(servers);
      expect((result['server'] as any).env.KEY).toBe('secret-key');

      delete process.env.API_KEY;
    });

    it('should expand env vars in http config', () => {
      process.env.BASE_URL = 'http://localhost:3000';

      const servers: McpServerEntry[] = [
        {
          name: 'http-server',
          config: {
            type: 'http',
            url: '${BASE_URL}/api',
            headers: {
              'X-API-Key': '${API_KEY:-default-key}',
            },
          },
          scope: 'user',
          enabled: true,
        },
      ];

      const result = buildSdkMcpServers(servers);
      expect((result['http-server'] as any).url).toBe('http://localhost:3000/api');
      expect((result['http-server'] as any).headers['X-API-Key']).toBe('default-key');

      delete process.env.BASE_URL;
    });
  });
});
