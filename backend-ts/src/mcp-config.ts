import fs from 'fs';
import path from 'path';
import os from 'os';

export interface McpStdioConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface McpSseConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig | McpSseConfig;

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  scope: 'user' | 'project';
  enabled: boolean;
}

// Expand ${VAR} and ${VAR:-default} in strings
function expandEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_match, varName, defaultVal) => {
    return process.env[varName] || defaultVal || '';
  });
}

function expandConfigEnvVars(config: McpServerConfig): McpServerConfig {
  const expanded = { ...config };

  if ('command' in expanded && expanded.command) {
    expanded.command = expandEnvVars(expanded.command);
  }
  if ('args' in expanded && expanded.args) {
    expanded.args = expanded.args.map(expandEnvVars);
  }
  if ('env' in expanded && expanded.env) {
    const newEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(expanded.env)) {
      newEnv[key] = expandEnvVars(val);
    }
    expanded.env = newEnv;
  }
  if ('url' in expanded && expanded.url) {
    expanded.url = expandEnvVars(expanded.url);
  }
  if ('headers' in expanded && expanded.headers) {
    const newHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(expanded.headers)) {
      newHeaders[key] = expandEnvVars(val);
    }
    expanded.headers = newHeaders;
  }

  return expanded;
}

function getClaudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function getUserMcpServers(): McpServerEntry[] {
  const claudeJson = readJsonFile(getClaudeJsonPath());
  const servers = (claudeJson.mcpServers || {}) as Record<string, McpServerConfig>;

  return Object.entries(servers).map(([name, config]) => ({
    name,
    config,
    scope: 'user' as const,
    enabled: true,
  }));
}

export function getProjectMcpServers(projectPath: string): McpServerEntry[] {
  const mcpJsonPath = path.join(projectPath, '.mcp.json');
  const mcpJson = readJsonFile(mcpJsonPath);
  const servers = (mcpJson.mcpServers || {}) as Record<string, McpServerConfig>;

  return Object.entries(servers).map(([name, config]) => ({
    name,
    config,
    scope: 'project' as const,
    enabled: true,
  }));
}

export function getAllMcpServers(projectPath?: string): McpServerEntry[] {
  const userServers = getUserMcpServers();
  const projectServers = projectPath ? getProjectMcpServers(projectPath) : [];

  // Project servers override user servers with same name
  const merged = new Map<string, McpServerEntry>();
  for (const server of userServers) {
    merged.set(server.name, server);
  }
  for (const server of projectServers) {
    merged.set(server.name, server);
  }

  return Array.from(merged.values());
}

export function addMcpServer(name: string, config: McpServerConfig, scope: 'user' | 'project', projectPath?: string): void {
  if (scope === 'user') {
    const claudeJsonPath = getClaudeJsonPath();
    const claudeJson = readJsonFile(claudeJsonPath);
    const servers = (claudeJson.mcpServers || {}) as Record<string, McpServerConfig>;
    const updatedServers = { ...servers, [name]: config };
    writeJsonFile(claudeJsonPath, { ...claudeJson, mcpServers: updatedServers });
  } else if (scope === 'project' && projectPath) {
    const mcpJsonPath = path.join(projectPath, '.mcp.json');
    const mcpJson = readJsonFile(mcpJsonPath);
    const servers = (mcpJson.mcpServers || {}) as Record<string, McpServerConfig>;
    const updatedServers = { ...servers, [name]: config };
    writeJsonFile(mcpJsonPath, { ...mcpJson, mcpServers: updatedServers });
  }
}

export function removeMcpServer(name: string, scope: 'user' | 'project', projectPath?: string): boolean {
  if (scope === 'user') {
    const claudeJsonPath = getClaudeJsonPath();
    const claudeJson = readJsonFile(claudeJsonPath);
    const servers = (claudeJson.mcpServers || {}) as Record<string, McpServerConfig>;
    if (!(name in servers)) return false;
    const { [name]: _removed, ...remaining } = servers;
    writeJsonFile(claudeJsonPath, { ...claudeJson, mcpServers: remaining });
    return true;
  } else if (scope === 'project' && projectPath) {
    const mcpJsonPath = path.join(projectPath, '.mcp.json');
    const mcpJson = readJsonFile(mcpJsonPath);
    const servers = (mcpJson.mcpServers || {}) as Record<string, McpServerConfig>;
    if (!(name in servers)) return false;
    const { [name]: _removed, ...remaining } = servers;
    writeJsonFile(mcpJsonPath, { ...mcpJson, mcpServers: remaining });
    return true;
  }
  return false;
}

// Build SDK-compatible mcpServers record with env vars expanded
export function buildSdkMcpServers(servers: McpServerEntry[]): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const server of servers) {
    if (server.enabled) {
      result[server.name] = expandConfigEnvVars(server.config);
    }
  }
  return result;
}
