/**
 * Decision Trail
 *
 * Synthesizes tool_usage rows into a human-readable decision trail
 * showing what the agent did, why, and in what order.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolUsageRow {
  id: number
  timestamp: string
  session_id: string
  tool_name: string
  duration_ms: number | null
  success: boolean | null
  error: string | null
  error_category: string | null
  parameters: Record<string, unknown> | string | null
  tool_use_id: string | null
  parent_agent_id: string | null
  agent_type: string | null
  input_tokens: number | null
  output_tokens: number | null
  description: string | null
}

export interface DecisionStep {
  sequence: number
  timestamp: string
  action: string
  tool: string
  agent: string | null
  duration_ms: number
  success: boolean
  children?: DecisionStep[]
}

export interface DecisionTrail {
  session_id: string
  total_steps: number
  total_duration_ms: number
  agents_involved: string[]
  files_touched: string[]
  tests_run: { passed: number; failed: number }
  narrative: string
  steps: DecisionStep[]
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function parseParameters(params: Record<string, unknown> | string | null): Record<string, unknown> | null {
  if (!params) return null
  if (typeof params === 'string') {
    try {
      return JSON.parse(params)
    } catch {
      return null
    }
  }
  return params
}

export function extractFilePath(params: Record<string, unknown> | null): string | null {
  if (!params) return null

  // Check common file path keys
  const filePath = params.file_path || params.path
  if (typeof filePath === 'string') {
    return filePath
  }

  return null
}

export function synthesizeAction(row: ToolUsageRow): string {
  const toolName = row.tool_name.toLowerCase()
  const params = parseParameters(row.parameters)

  // Read operations
  if (toolName === 'read' || toolName === 'readfile') {
    const filePath = extractFilePath(params)
    if (filePath) {
      return `Read ${filePath} to understand context`
    }
    return 'Read file to understand context'
  }

  // Edit/Write operations
  if (toolName === 'edit' || toolName === 'write' || toolName === 'multiedit') {
    const filePath = extractFilePath(params)
    if (filePath) {
      return `Modified ${filePath}`
    }
    return 'Modified file'
  }

  // Bash commands
  if (toolName === 'bash') {
    const command = params?.command as string | undefined
    const success = row.success ?? false
    if (command) {
      const status = success ? 'succeeded' : 'failed'
      return `Ran \`${command}\` — ${status}`
    }
    return 'Executed bash command'
  }

  // Grep operations
  if (toolName === 'grep') {
    const pattern = params?.pattern as string | undefined
    const path = params?.path as string | undefined
    if (pattern) {
      const location = path ? ` in ${path}` : ''
      return `Searched for '${pattern}'${location}`
    }
    return 'Searched codebase'
  }

  // Glob operations
  if (toolName === 'glob') {
    const pattern = params?.pattern as string | undefined
    if (pattern) {
      return `Found files matching '${pattern}'`
    }
    return 'Found matching files'
  }

  // Agent delegation
  if (toolName === 'agent' && row.agent_type) {
    const description = row.description || 'task'
    return `Delegated to ${row.agent_type}: ${description}`
  }

  // Default
  const description = row.description || 'executed'
  return `${row.tool_name}: ${description}`
}

export function collectFilesTouched(rows: ToolUsageRow[]): string[] {
  const files = new Set<string>()

  for (const row of rows) {
    const toolName = row.tool_name.toLowerCase()

    // Only collect from file-modifying tools (exclude read operations)
    if (toolName === 'edit' || toolName === 'write' || toolName === 'multiedit') {
      const params = parseParameters(row.parameters)
      const filePath = extractFilePath(params)
      if (filePath) {
        files.add(filePath)
      }
    }
  }

  return Array.from(files).sort()
}

export function collectTestResults(rows: ToolUsageRow[]): { passed: number; failed: number } {
  let passed = 0
  let failed = 0

  for (const row of rows) {
    const toolName = row.tool_name.toLowerCase()

    if (toolName === 'bash') {
      const params = parseParameters(row.parameters)
      const command = params?.command as string | undefined

      if (command) {
        const lowerCommand = command.toLowerCase()
        // Detect test commands
        if (lowerCommand.includes('test') ||
            lowerCommand.includes('vitest') ||
            lowerCommand.includes('jest')) {

          if (row.success === true) {
            passed++
          } else if (row.success === false) {
            failed++
          }
        }
      }
    }
  }

  return { passed, failed }
}

export function buildDecisionSteps(rows: ToolUsageRow[], agentId: string | null = null): DecisionStep[] {
  // Filter rows for this agent level
  const relevantRows = rows.filter(row => row.parent_agent_id === agentId)

  const steps: DecisionStep[] = []

  for (const row of relevantRows) {
    const step: DecisionStep = {
      sequence: steps.length + 1,
      timestamp: row.timestamp,
      action: synthesizeAction(row),
      tool: row.tool_name,
      agent: row.agent_type,
      duration_ms: row.duration_ms ?? 0,
      success: row.success ?? true
    }

    // Recursively build children if this is an agent invocation
    if (row.tool_name.toLowerCase() === 'agent' && row.tool_use_id) {
      const children = buildDecisionSteps(rows, row.tool_use_id)
      if (children.length > 0) {
        step.children = children
      }
    }

    steps.push(step)
  }

  return steps
}

export function buildNarrative(
  steps: DecisionStep[],
  filesTouched: string[],
  testResults: { passed: number; failed: number },
  agentsInvolved: string[]
): string {
  if (steps.length === 0) {
    return 'No actions recorded for this session.'
  }

  const parts: string[] = []

  // Summarize agents
  if (agentsInvolved.length > 0) {
    const agentList = agentsInvolved.join(', ')
    parts.push(`Involved agents: ${agentList}.`)
  }

  // Summarize file operations
  if (filesTouched.length > 0) {
    const fileCount = filesTouched.length
    const fileWord = fileCount === 1 ? 'file' : 'files'
    parts.push(`Modified ${fileCount} ${fileWord}.`)
  }

  // Summarize test results
  const totalTests = testResults.passed + testResults.failed
  if (totalTests > 0) {
    parts.push(`Ran ${totalTests} test command(s): ${testResults.passed} passed, ${testResults.failed} failed.`)
  }

  return parts.join(' ')
}

export function buildDecisionTrail(sessionId: string, rows: ToolUsageRow[]): DecisionTrail {
  // Build hierarchical steps
  const steps = buildDecisionSteps(rows, null)

  // Collect metadata
  const filesTouched = collectFilesTouched(rows)
  const testResults = collectTestResults(rows)

  // Collect unique agents
  const agentsSet = new Set<string>()
  for (const row of rows) {
    if (row.agent_type) {
      agentsSet.add(row.agent_type)
    }
  }
  const agentsInvolved = Array.from(agentsSet).sort()

  // Calculate total duration
  let totalDuration = 0
  for (const row of rows) {
    if (row.duration_ms) {
      totalDuration += row.duration_ms
    }
  }

  // Build narrative
  const narrative = buildNarrative(steps, filesTouched, testResults, agentsInvolved)

  return {
    session_id: sessionId,
    total_steps: steps.length,
    total_duration_ms: totalDuration,
    agents_involved: agentsInvolved,
    files_touched: filesTouched,
    tests_run: testResults,
    narrative,
    steps
  }
}
