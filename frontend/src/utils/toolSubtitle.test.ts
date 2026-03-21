import { truncate, hostnameOnly, shortenPath, getToolSubtitle } from './toolSubtitle';
import { ToolNode } from '../types';

describe('truncate', () => {
  it('returns empty string for empty input', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('returns string as-is when under max length', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates string with ellipsis when over max length', () => {
    expect(truncate('hello world', 8)).toBe('hello wo…');
  });
});

describe('hostnameOnly', () => {
  it('extracts hostname from valid URL', () => {
    expect(hostnameOnly('https://example.com/path/to/page')).toBe('example.com');
  });

  it('handles URL with port', () => {
    expect(hostnameOnly('http://localhost:3000/api')).toBe('localhost');
  });

  it('truncates invalid URL', () => {
    expect(hostnameOnly('not a url')).toBe('not a url');
  });

  it('truncates long invalid URL', () => {
    const longString = 'x'.repeat(100);
    const result = hostnameOnly(longString);
    expect(result.length).toBe(61);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('shortenPath', () => {
  it('returns empty string for empty input', () => {
    expect(shortenPath('')).toBe('');
  });

  it('strips worktree prefix', () => {
    const path = '/Users/foo/project/.claude/worktrees/some-branch/src/file.ts';
    expect(shortenPath(path)).toBe('src/file.ts');
  });

  it('strips workspace prefix when provided', () => {
    const workspacePath = '/Users/foo/Workspace/ccplus';
    const path = '/Users/foo/Workspace/ccplus/frontend/src/App.tsx';
    expect(shortenPath(path, workspacePath)).toBe('frontend/src/App.tsx');
  });

  it('handles workspace path with trailing slash', () => {
    const workspacePath = '/Users/foo/Workspace/ccplus/';
    const path = '/Users/foo/Workspace/ccplus/backend-ts/src/server.ts';
    expect(shortenPath(path, workspacePath)).toBe('backend-ts/src/server.ts');
  });

  it('returns last 3 segments for long paths without workspace', () => {
    const path = '/very/long/path/with/many/segments/file.ts';
    expect(shortenPath(path)).toBe('…/many/segments/file.ts');
  });

  it('returns path as-is when 3 or fewer segments', () => {
    expect(shortenPath('/a/b/c')).toBe('/a/b/c');
  });
});

describe('getToolSubtitle', () => {
  const createToolNode = (
    tool_name: string,
    parameters: Record<string, unknown>
  ): ToolNode => ({
    tool_use_id: 'test-id',
    tool_name,
    timestamp: new Date().toISOString(),
    status: 'completed',
    parameters,
    parent_agent_id: null,
  });

  it('returns file path for Read tool', () => {
    const node = createToolNode('Read', { file_path: '/Users/foo/project/src/file.ts' });
    const result = getToolSubtitle(node, '/Users/foo/project');
    expect(result).toBe('src/file.ts');
  });

  it('returns file path for Write tool', () => {
    const node = createToolNode('Write', { file_path: '/path/to/file.txt' });
    const result = getToolSubtitle(node);
    expect(result).toBe('/path/to/file.txt');
  });

  it('returns file path for Edit tool', () => {
    const node = createToolNode('Edit', { file_path: '/a/b/c.ts' });
    expect(getToolSubtitle(node)).toBe('/a/b/c.ts');
  });

  it('returns truncated command for Bash tool', () => {
    const longCommand = 'a'.repeat(100);
    const node = createToolNode('Bash', { command: longCommand });
    const result = getToolSubtitle(node);
    expect(result?.length).toBe(61);
    expect(result?.endsWith('…')).toBe(true);
  });

  it('returns pattern for Grep tool without path', () => {
    const node = createToolNode('Grep', { pattern: 'searchTerm' });
    expect(getToolSubtitle(node)).toBe('searchTerm');
  });

  it('returns pattern and path for Grep tool with path', () => {
    const node = createToolNode('Grep', {
      pattern: 'searchTerm',
      path: '/Users/foo/project/src',
    });
    const result = getToolSubtitle(node, '/Users/foo/project');
    expect(result).toBe('searchTerm · src');
  });

  it('returns pattern for Glob tool', () => {
    const node = createToolNode('Glob', { pattern: '**/*.ts' });
    expect(getToolSubtitle(node)).toBe('**/*.ts');
  });

  it('returns query for WebSearch tool', () => {
    const node = createToolNode('WebSearch', { query: 'how to test react' });
    expect(getToolSubtitle(node)).toBe('how to test react');
  });

  it('returns hostname for WebFetch tool', () => {
    const node = createToolNode('WebFetch', { url: 'https://api.example.com/data' });
    expect(getToolSubtitle(node)).toBe('api.example.com');
  });

  it('returns null for tool without parameters', () => {
    const node = createToolNode('UnknownTool', {});
    expect(getToolSubtitle(node)).toBeNull();
  });

  it('returns null for unknown tool', () => {
    const node = createToolNode('CustomTool', { some_param: 'value' });
    expect(getToolSubtitle(node)).toBeNull();
  });

  it('handles missing parameters gracefully', () => {
    const node: ToolNode = {
      tool_use_id: 'test-id',
      tool_name: 'Read',
      timestamp: new Date().toISOString(),
      status: 'completed',
      parent_agent_id: null,
    };
    expect(getToolSubtitle(node)).toBeNull();
  });
});
