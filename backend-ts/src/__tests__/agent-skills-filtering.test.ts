import { describe, it, expect } from 'vitest';
import { filterPluginsByAgent, filterMcpServersByAgent } from '../sdk/stream-query.js';
import type { ResolvedAgent } from '../agent-config.js';
import type { McpServerEntry } from '../mcp-config.js';

describe('agent skills filtering', () => {
  const mockPlugins = [
    { type: 'local' as const, path: '/path/to/frontend-patterns' },
    { type: 'local' as const, path: '/path/to/impeccable' },
    { type: 'local' as const, path: '/other/tdd' },
  ];

  const mockMcpServers: McpServerEntry[] = [
    { name: 'playwright', config: { type: 'http', url: 'http://localhost' }, scope: 'user', enabled: true },
    { name: 'chrome-devtools', config: { type: 'http', url: 'http://localhost' }, scope: 'user', enabled: true },
    { name: 'filesystem', config: { command: 'mcp-filesystem' }, scope: 'project', enabled: true },
  ];

  describe('filterPluginsByAgent', () => {
    it('returns all plugins when agentConfig is null', () => {
      const result = filterPluginsByAgent(mockPlugins, null);
      expect(result).toEqual(mockPlugins);
    });

    it('returns all plugins when agentConfig is undefined', () => {
      const result = filterPluginsByAgent(mockPlugins, undefined);
      expect(result).toEqual(mockPlugins);
    });

    it('returns all plugins when agent has no skills config', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
      };
      const result = filterPluginsByAgent(mockPlugins, agent);
      expect(result).toEqual(mockPlugins);
    });

    it('returns all plugins when skills.available is empty', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        skills: { available: [] },
      };
      const result = filterPluginsByAgent(mockPlugins, agent);
      expect(result).toEqual(mockPlugins);
    });

    it('filters plugins to only matching ones', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        skills: {
          available: ['frontend-patterns', 'tdd'],
        },
      };
      const result = filterPluginsByAgent(mockPlugins, agent);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ type: 'local', path: '/path/to/frontend-patterns' });
      expect(result).toContainEqual({ type: 'local', path: '/other/tdd' });
    });

    it('returns empty array when no plugins match', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        skills: {
          available: ['nonexistent-skill'],
        },
      };
      const result = filterPluginsByAgent(mockPlugins, agent);
      expect(result).toEqual([]);
    });

    it('matches plugin path basename exactly', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        skills: {
          available: ['impeccable'],
        },
      };
      const result = filterPluginsByAgent(mockPlugins, agent);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/path/to/impeccable');
    });

    it('includes required skills even when not in available list', () => {
      const mockPluginsExtended = [
        { type: 'local' as const, path: '/path/to/frontend-patterns' },
        { type: 'local' as const, path: '/path/to/frontend-design' },
        { type: 'local' as const, path: '/path/to/impeccable' },
      ];
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        skills: {
          required: ['frontend-patterns', 'frontend-design'],
          available: ['impeccable'],
        },
      };
      const result = filterPluginsByAgent(mockPluginsExtended, agent);
      expect(result).toHaveLength(3); // all three matched plugins
    });
  });

  describe('filterMcpServersByAgent', () => {
    it('returns all servers when agentConfig is null', () => {
      const result = filterMcpServersByAgent(mockMcpServers, null);
      expect(result).toEqual(mockMcpServers);
    });

    it('returns all servers when agentConfig is undefined', () => {
      const result = filterMcpServersByAgent(mockMcpServers, undefined);
      expect(result).toEqual(mockMcpServers);
    });

    it('returns all servers when agent has no mcpServers config', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
      };
      const result = filterMcpServersByAgent(mockMcpServers, agent);
      expect(result).toEqual(mockMcpServers);
    });

    it('returns all servers when mcpServers is empty', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        mcpServers: [],
      };
      const result = filterMcpServersByAgent(mockMcpServers, agent);
      expect(result).toEqual(mockMcpServers);
    });

    it('filters servers to only matching names', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        mcpServers: ['playwright', 'filesystem'],
      };
      const result = filterMcpServersByAgent(mockMcpServers, agent);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(mockMcpServers[0]); // playwright
      expect(result).toContainEqual(mockMcpServers[2]); // filesystem
    });

    it('returns empty array when no servers match', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        mcpServers: ['nonexistent-server'],
      };
      const result = filterMcpServersByAgent(mockMcpServers, agent);
      expect(result).toEqual([]);
    });

    it('matches server name exactly', () => {
      const agent: ResolvedAgent = {
        id: 'test',
        name: 'Test Agent',
        dirPath: '/test',
        mcpServers: ['chrome-devtools'],
      };
      const result = filterMcpServersByAgent(mockMcpServers, agent);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('chrome-devtools');
    });
  });
});
