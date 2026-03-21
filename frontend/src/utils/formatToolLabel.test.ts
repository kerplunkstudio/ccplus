import { formatToolLabel, formatToolLabelVerbose, sanitizeBashCommand } from './formatToolLabel';
import { ToolEvent } from '../types';

describe('sanitizeBashCommand', () => {
  it('strips cd with unquoted path and &&', () => {
    expect(sanitizeBashCommand('cd /some/path && git status')).toBe('git status');
  });

  it('strips cd with quoted path and &&', () => {
    expect(sanitizeBashCommand('cd "/path with spaces" && npm test')).toBe('npm test');
  });

  it('strips cd with single-quoted path and &&', () => {
    expect(sanitizeBashCommand("cd '/path with spaces' && npm test")).toBe('npm test');
  });

  it('strips cd with unquoted path and semicolon', () => {
    expect(sanitizeBashCommand('cd /foo; npm install')).toBe('npm install');
  });

  it('strips cd with quoted path and semicolon', () => {
    expect(sanitizeBashCommand('cd "/foo bar"; npm install')).toBe('npm install');
  });

  it('does not modify command without cd prefix', () => {
    expect(sanitizeBashCommand('git log')).toBe('git log');
  });

  it('strips multiple cd prefixes', () => {
    expect(sanitizeBashCommand('cd /foo && cd /bar && git push')).toBe('git push');
  });

  it('strips multiple cd prefixes with mixed separators', () => {
    expect(sanitizeBashCommand('cd /foo; cd /bar && git push')).toBe('git push');
  });

  it('handles whitespace variations', () => {
    expect(sanitizeBashCommand('  cd   /path  &&  npm test')).toBe('npm test');
  });

  it('handles empty string', () => {
    expect(sanitizeBashCommand('')).toBe('');
  });
});

describe('formatToolLabel', () => {
  describe('Read tool', () => {
    it('formats Read with file path', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { file_path: '/path/to/file.txt' },
      };

      expect(formatToolLabel(event)).toBe('Read file.txt');
    });

    it('handles missing file_path parameter', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: {},
      };

      expect(formatToolLabel(event)).toBe('Read ');
    });

    it('handles undefined parameters', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      expect(formatToolLabel(event)).toBe('Read ');
    });

    it('extracts basename from nested path', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { file_path: '/very/deep/nested/path/document.md' },
      };

      expect(formatToolLabel(event)).toBe('Read document.md');
    });
  });

  describe('Write tool', () => {
    it('formats Write with file path', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Write',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { file_path: '/output/result.json', content: '{}' },
      };

      expect(formatToolLabel(event)).toBe('Write result.json');
    });

    it('handles missing file_path', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Write',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { content: 'Hello world' },
      };

      expect(formatToolLabel(event)).toBe('Write ');
    });
  });

  describe('Edit tool', () => {
    it('formats Edit with file path', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Edit',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { file_path: '/src/index.ts', old_string: 'foo', new_string: 'bar' },
      };

      expect(formatToolLabel(event)).toBe('Edit index.ts');
    });
  });

  describe('Bash tool', () => {
    it('formats Bash with short command', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { command: 'ls -la' },
      };

      expect(formatToolLabel(event)).toBe('Bash ls -la');
    });

    it('truncates long Bash command at 50 chars', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { command: 'find . -name "*.ts" -exec grep -l "export" {} \\; | xargs wc -l' },
      };

      const result = formatToolLabel(event);
      expect(result).toContain('...');
      expect(result.startsWith('Bash find . -name "*.ts" -exec grep -l "export" {} \\')).toBe(true);
      expect(result.length).toBe(58); // "Bash " + 50 chars + "..."
    });

    it('does not truncate command exactly 50 chars', () => {
      const command = 'x'.repeat(50);
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { command },
      };

      expect(formatToolLabel(event)).toBe(`Bash ${command}`);
      expect(formatToolLabel(event)).not.toContain('...');
    });

    it('handles missing command parameter', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: {},
      };

      expect(formatToolLabel(event)).toBe('Bash ');
    });
  });

  describe('Glob tool', () => {
    it('formats Glob with pattern', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Glob',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { pattern: '**/*.ts' },
      };

      expect(formatToolLabel(event)).toBe('Glob **/*.ts');
    });

    it('handles missing pattern', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Glob',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: {},
      };

      expect(formatToolLabel(event)).toBe('Glob ');
    });
  });

  describe('Grep tool', () => {
    it('formats Grep with pattern', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Grep',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { pattern: 'TODO' },
      };

      expect(formatToolLabel(event)).toBe('Grep TODO');
    });

    it('handles missing pattern', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Grep',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: {},
      };

      expect(formatToolLabel(event)).toBe('Grep ');
    });
  });

  describe('Agent tool', () => {
    it('formats Agent with agent_type', () => {
      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        agent_type: 'code_agent',
      };

      expect(formatToolLabel(event)).toBe('code_agent');
    });

    it('falls back to "agent" if agent_type is missing', () => {
      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      expect(formatToolLabel(event)).toBe('agent');
    });
  });

  describe('Task tool', () => {
    it('formats Task with agent_type', () => {
      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Task',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        agent_type: 'tdd_guide',
      };

      expect(formatToolLabel(event)).toBe('tdd_guide');
    });

    it('falls back to "agent" if agent_type is missing', () => {
      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Task',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      expect(formatToolLabel(event)).toBe('agent');
    });
  });

  describe('Unknown tool', () => {
    it('returns tool_name for unknown tools', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'CustomTool',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { foo: 'bar' },
      };

      expect(formatToolLabel(event)).toBe('CustomTool');
    });
  });
});

describe('formatToolLabelVerbose', () => {
  describe('Read tool', () => {
    it('formats Read verbosely', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { file_path: '/path/to/file.txt' },
      };

      expect(formatToolLabelVerbose(event)).toBe('Reading file.txt');
    });

    it('handles missing file_path', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Read',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: {},
      };

      expect(formatToolLabelVerbose(event)).toBe('Reading ');
    });
  });

  describe('Write tool', () => {
    it('formats Write verbosely', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Write',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { file_path: '/output/result.json' },
      };

      expect(formatToolLabelVerbose(event)).toBe('Writing result.json');
    });
  });

  describe('Edit tool', () => {
    it('formats Edit verbosely', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Edit',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { file_path: '/src/index.ts' },
      };

      expect(formatToolLabelVerbose(event)).toBe('Editing index.ts');
    });
  });

  describe('Bash tool', () => {
    it('formats Bash verbosely with short command', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { command: 'npm test' },
      };

      expect(formatToolLabelVerbose(event)).toBe('Running npm test');
    });

    it('truncates Bash command at 40 chars', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { command: 'find . -name "*.ts" -exec grep -l "export" {} \\;' },
      };

      const result = formatToolLabelVerbose(event);
      expect(result).toMatch(/^Running find \. -name/);
      expect(result.length).toBe(48); // "Running " + 40 chars (slice doesn't add ...)
    });

    it('handles missing command', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Bash',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: {},
      };

      expect(formatToolLabelVerbose(event)).toBe('Running ');
    });
  });

  describe('Glob tool', () => {
    it('formats Glob verbosely', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Glob',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { pattern: '**/*.ts' },
      };

      expect(formatToolLabelVerbose(event)).toBe('Searching **/*.ts');
    });
  });

  describe('Grep tool', () => {
    it('formats Grep verbosely', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'Grep',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        parameters: { pattern: 'TODO' },
      };

      expect(formatToolLabelVerbose(event)).toBe('Searching TODO');
    });
  });

  describe('Agent tool', () => {
    it('formats Agent verbosely with agent_type', () => {
      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        agent_type: 'code_agent',
      };

      expect(formatToolLabelVerbose(event)).toBe('Using code_agent');
    });

    it('falls back to "agent" if agent_type is missing', () => {
      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Agent',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      expect(formatToolLabelVerbose(event)).toBe('Using agent');
    });
  });

  describe('Task tool', () => {
    it('formats Task verbosely with agent_type', () => {
      const event: ToolEvent = {
        type: 'agent_start',
        tool_name: 'Task',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
        agent_type: 'tdd_guide',
      };

      expect(formatToolLabelVerbose(event)).toBe('Using tdd_guide');
    });
  });

  describe('Unknown tool', () => {
    it('formats unknown tool verbosely', () => {
      const event: ToolEvent = {
        type: 'tool_start',
        tool_name: 'CustomTool',
        tool_use_id: 'tool_1',
        parent_agent_id: null,
        timestamp: '2025-01-01T00:00:00Z',
      };

      expect(formatToolLabelVerbose(event)).toBe('Using CustomTool');
    });
  });
});
