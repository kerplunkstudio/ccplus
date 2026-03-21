import { ToolNode } from '../types';

export function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export function hostnameOnly(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return truncate(url, 60);
  }
}

export function shortenPath(path: string, workspacePath?: string): string {
  if (!path) return '';

  const worktreeMatch = path.match(/^(.*?)\/\.claude\/worktrees\/[^/]+\/(.*)/);
  if (worktreeMatch) {
    return worktreeMatch[2];
  }

  if (workspacePath) {
    const prefix = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/';
    if (path.startsWith(prefix)) {
      return path.slice(prefix.length);
    }
  }

  const parts = path.split('/').filter(Boolean);
  if (parts.length > 3) {
    return '…/' + parts.slice(-3).join('/');
  }
  return path;
}

export function getToolSubtitle(node: ToolNode, workspacePath?: string): string | null {
  const p = node.parameters;
  if (!p) return null;

  switch (node.tool_name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return p.file_path ? shortenPath(String(p.file_path), workspacePath) : null;
    case 'Bash':
      return p.command ? truncate(String(p.command), 60) : null;
    case 'Grep': {
      const pattern = p.pattern ? String(p.pattern) : '';
      const searchPath = p.path ? shortenPath(String(p.path), workspacePath) : '';
      if (!pattern) return null;
      return searchPath ? `${pattern} · ${searchPath}` : pattern;
    }
    case 'Glob':
      return p.pattern ? truncate(String(p.pattern), 60) : null;
    case 'WebSearch':
      return p.query ? truncate(String(p.query), 60) : null;
    case 'WebFetch':
      return p.url ? hostnameOnly(String(p.url)) : null;
    default:
      return null;
  }
}
