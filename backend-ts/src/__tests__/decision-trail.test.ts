import { describe, it, expect } from 'vitest'
import {
  synthesizeAction,
  extractFilePath,
  collectFilesTouched,
  collectTestResults,
  buildDecisionTrail,
  type ToolUsageRow
} from '../decision-trail.js'

// ---------------------------------------------------------------------------
// Test Data Factory
// ---------------------------------------------------------------------------

function makeToolRow(overrides?: Partial<ToolUsageRow>): ToolUsageRow {
  return {
    id: 1,
    timestamp: '2026-03-20T10:00:00',
    session_id: 'test-session',
    tool_name: 'Unknown',
    duration_ms: 100,
    success: true,
    error: null,
    error_category: null,
    parameters: null,
    tool_use_id: 'tool-1',
    parent_agent_id: null,
    agent_type: null,
    input_tokens: null,
    output_tokens: null,
    description: null,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('synthesizeAction', () => {
  it('handles Read tool with file_path', () => {
    const row = makeToolRow({
      tool_name: 'Read',
      parameters: { file_path: '/path/to/file.ts' }
    })
    expect(synthesizeAction(row)).toBe('Read /path/to/file.ts to understand context')
  })

  it('handles Edit tool with file_path', () => {
    const row = makeToolRow({
      tool_name: 'Edit',
      parameters: { file_path: '/src/server.ts' }
    })
    expect(synthesizeAction(row)).toBe('Modified /src/server.ts')
  })

  it('handles Write tool with file_path', () => {
    const row = makeToolRow({
      tool_name: 'Write',
      parameters: { file_path: '/new-file.ts' }
    })
    expect(synthesizeAction(row)).toBe('Modified /new-file.ts')
  })

  it('handles Bash tool with success', () => {
    const row = makeToolRow({
      tool_name: 'Bash',
      parameters: { command: 'npm test' },
      success: true
    })
    expect(synthesizeAction(row)).toBe('Ran `npm test` — succeeded')
  })

  it('handles Bash tool with failure', () => {
    const row = makeToolRow({
      tool_name: 'Bash',
      parameters: { command: 'npm test' },
      success: false
    })
    expect(synthesizeAction(row)).toBe('Ran `npm test` — failed')
  })

  it('handles Grep tool with pattern and path', () => {
    const row = makeToolRow({
      tool_name: 'Grep',
      parameters: { pattern: 'function.*test', path: '/src' }
    })
    expect(synthesizeAction(row)).toBe('Searched for \'function.*test\' in /src')
  })

  it('handles Glob tool with pattern', () => {
    const row = makeToolRow({
      tool_name: 'Glob',
      parameters: { pattern: '**/*.ts' }
    })
    expect(synthesizeAction(row)).toBe('Found files matching \'**/*.ts\'')
  })

  it('handles Agent spawn with agent_type and description', () => {
    const row = makeToolRow({
      tool_name: 'Agent',
      agent_type: 'code_agent',
      description: 'Implement feature X'
    })
    expect(synthesizeAction(row)).toBe('Delegated to code_agent: Implement feature X')
  })

  it('handles unknown tool with description', () => {
    const row = makeToolRow({
      tool_name: 'CustomTool',
      description: 'Custom action'
    })
    expect(synthesizeAction(row)).toBe('CustomTool: Custom action')
  })

  it('handles null parameters gracefully', () => {
    const row = makeToolRow({
      tool_name: 'Read',
      parameters: null
    })
    expect(synthesizeAction(row)).toBe('Read file to understand context')
  })

  it('handles case-insensitive tool names', () => {
    const row = makeToolRow({
      tool_name: 'BASH',
      parameters: { command: 'ls' },
      success: true
    })
    expect(synthesizeAction(row)).toBe('Ran `ls` — succeeded')
  })
})

describe('extractFilePath', () => {
  it('extracts file_path from params', () => {
    expect(extractFilePath({ file_path: '/test.ts' })).toBe('/test.ts')
  })

  it('extracts path from params', () => {
    expect(extractFilePath({ path: '/src/file.ts' })).toBe('/src/file.ts')
  })

  it('returns null for null params', () => {
    expect(extractFilePath(null)).toBe(null)
  })

  it('returns null when no file path keys present', () => {
    expect(extractFilePath({ command: 'ls' })).toBe(null)
  })
})

describe('collectFilesTouched', () => {
  it('collects unique file paths from Read/Edit/Write', () => {
    const rows = [
      makeToolRow({ tool_name: 'Read', parameters: { file_path: '/a.ts' } }),
      makeToolRow({ tool_name: 'Edit', parameters: { file_path: '/b.ts' } }),
      makeToolRow({ tool_name: 'Write', parameters: { file_path: '/c.ts' } }),
      makeToolRow({ tool_name: 'Read', parameters: { file_path: '/a.ts' } }) // duplicate
    ]
    const files = collectFilesTouched(rows)
    expect(files).toEqual(['/a.ts', '/b.ts', '/c.ts'])
  })

  it('ignores non-file tools', () => {
    const rows = [
      makeToolRow({ tool_name: 'Bash', parameters: { command: 'ls' } }),
      makeToolRow({ tool_name: 'Grep', parameters: { pattern: 'test' } })
    ]
    const files = collectFilesTouched(rows)
    expect(files).toEqual([])
  })

  it('handles rows with null parameters', () => {
    const rows = [
      makeToolRow({ tool_name: 'Read', parameters: null })
    ]
    const files = collectFilesTouched(rows)
    expect(files).toEqual([])
  })
})

describe('collectTestResults', () => {
  it('counts passed and failed tests', () => {
    const rows = [
      makeToolRow({ tool_name: 'Bash', parameters: { command: 'npm test' }, success: true }),
      makeToolRow({ tool_name: 'Bash', parameters: { command: 'vitest run' }, success: true }),
      makeToolRow({ tool_name: 'Bash', parameters: { command: 'jest' }, success: false })
    ]
    const results = collectTestResults(rows)
    expect(results).toEqual({ passed: 2, failed: 1 })
  })

  it('ignores non-test commands', () => {
    const rows = [
      makeToolRow({ tool_name: 'Bash', parameters: { command: 'ls' }, success: true }),
      makeToolRow({ tool_name: 'Bash', parameters: { command: 'npm install' }, success: true })
    ]
    const results = collectTestResults(rows)
    expect(results).toEqual({ passed: 0, failed: 0 })
  })

  it('handles case-insensitive test detection', () => {
    const rows = [
      makeToolRow({ tool_name: 'Bash', parameters: { command: 'NPM TEST' }, success: true })
    ]
    const results = collectTestResults(rows)
    expect(results).toEqual({ passed: 1, failed: 0 })
  })
})

describe('buildDecisionTrail', () => {
  it('builds trail for empty session', () => {
    const trail = buildDecisionTrail('empty-session', [])
    expect(trail.session_id).toBe('empty-session')
    expect(trail.total_steps).toBe(0)
    expect(trail.total_duration_ms).toBe(0)
    expect(trail.agents_involved).toEqual([])
    expect(trail.files_touched).toEqual([])
    expect(trail.tests_run).toEqual({ passed: 0, failed: 0 })
    expect(trail.narrative).toBe('No actions recorded for this session.')
    expect(trail.steps).toEqual([])
  })

  it('builds trail for realistic session with mixed tools', () => {
    const rows: ToolUsageRow[] = [
      makeToolRow({
        id: 1,
        tool_name: 'Read',
        parameters: { file_path: '/src/server.ts' },
        duration_ms: 50,
        timestamp: '2026-03-20T10:00:00'
      }),
      makeToolRow({
        id: 2,
        tool_name: 'Edit',
        parameters: { file_path: '/src/server.ts' },
        duration_ms: 150,
        timestamp: '2026-03-20T10:00:01'
      }),
      makeToolRow({
        id: 3,
        tool_name: 'Bash',
        parameters: { command: 'npm test' },
        success: true,
        duration_ms: 2000,
        timestamp: '2026-03-20T10:00:02'
      }),
      makeToolRow({
        id: 4,
        tool_name: 'Agent',
        agent_type: 'code_agent',
        description: 'Fix bug',
        tool_use_id: 'agent-1',
        duration_ms: 5000,
        timestamp: '2026-03-20T10:00:03'
      })
    ]

    const trail = buildDecisionTrail('test-session', rows)

    expect(trail.session_id).toBe('test-session')
    expect(trail.total_steps).toBe(4)
    expect(trail.total_duration_ms).toBe(7200)
    expect(trail.agents_involved).toEqual(['code_agent'])
    expect(trail.files_touched).toEqual(['/src/server.ts'])
    expect(trail.tests_run).toEqual({ passed: 1, failed: 0 })
    expect(trail.narrative).toContain('code_agent')
    expect(trail.narrative).toContain('1 file')
    expect(trail.narrative).toContain('1 test')
    expect(trail.steps.length).toBe(4)
    expect(trail.steps[0].action).toBe('Read /src/server.ts to understand context')
    expect(trail.steps[1].action).toBe('Modified /src/server.ts')
    expect(trail.steps[2].action).toBe('Ran `npm test` — succeeded')
    expect(trail.steps[3].action).toBe('Delegated to code_agent: Fix bug')
  })
})
