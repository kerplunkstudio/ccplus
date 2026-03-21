// Trust score computation engine for cc+ sessions

// Input interfaces
export interface SessionToolData {
  tool_name: string;
  parameters: string;
  success: number;
  error?: string | null;
  timestamp: string;
  parent_agent_id?: string | null;
}

export interface SessionQueryData {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  timestamp: string;
}

export interface SessionConversationData {
  role: string;
  content: string;
  timestamp: string;
  project_path?: string | null;
}

// Output interfaces
export interface TrustDimensions {
  test_coverage: number;
  scope_discipline: number;
  error_rate: number;
  cost_efficiency: number;
  security: number;
}

export interface TrustSummary {
  files_touched: string[];
  files_created: string[];
  files_deleted: string[];
  files_written: string[];
  tests_run: number;
  tests_passed: number;
  tests_failed: number;
  total_tool_calls: number;
  failed_tool_calls: number;
  total_tokens: number;
  total_cost_usd: number;
  duration_ms: number;
  agents_spawned: number;
  security_flags: string[];
}

export interface TrustFlag {
  severity: "info" | "warning" | "critical";
  message: string;
  detail?: string;
}

export interface TrustMetrics {
  session_id: string;
  overall_score: number;
  dimensions: TrustDimensions;
  summary: TrustSummary;
  flags: TrustFlag[];
}

function parseParameters(parametersString: string): Record<string, unknown> {
  try {
    return JSON.parse(parametersString);
  } catch {
    return {};
  }
}

function extractFilePath(params: Record<string, unknown>): string | null {
  if (params.file_path && typeof params.file_path === "string") return params.file_path;
  if (params.path && typeof params.path === "string") return params.path;
  return null;
}

function isTestCommand(command: string): boolean {
  const testPatterns = [/\btest\b/i, /\bvitest\b/i, /\bjest\b/i, /\bpytest\b/i, /npm\s+test/i, /go\s+test/i];
  return testPatterns.some((pattern) => pattern.test(command));
}

function extractDeletedFiles(command: string): string[] {
  const deleted: string[] = [];
  const rmPattern = /rm\s+(?:-[rf]+\s+)?([^\s;|&]+)/g;
  let match;
  while ((match = rmPattern.exec(command)) !== null) {
    const filename = match[1];
    if (filename && !filename.startsWith("-")) deleted.push(filename);
  }
  return deleted;
}

export function computeSummary(
  tools: SessionToolData[],
  queries: SessionQueryData[],
  conversations: SessionConversationData[]
): TrustSummary {
  const filesTouched = new Set<string>();
  const filesCreated = new Set<string>();
  const filesDeleted = new Set<string>();
  const filesWritten = new Set<string>();
  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let agentsSpawned = 0;
  const securityFlags: string[] = [];

  for (const tool of tools) {
    const paramStr = tool.parameters ?? "";
    const params = parseParameters(paramStr);

    if (tool.tool_name === "Write") {
      const filePath = extractFilePath(params);
      if (filePath) { filesCreated.add(filePath); filesTouched.add(filePath); filesWritten.add(filePath); }
    } else if (tool.tool_name === "Edit" || tool.tool_name === "Read") {
      const filePath = extractFilePath(params);
      if (filePath) filesTouched.add(filePath);
      if (tool.tool_name === "Edit" && filePath) filesWritten.add(filePath);
    } else if (tool.tool_name === "Glob" || tool.tool_name === "Grep") {
      const filePath = extractFilePath(params);
      if (filePath) filesTouched.add(filePath);
    }

    if (tool.tool_name === "Bash" && params.command && typeof params.command === "string") {
      const command = params.command;
      if (isTestCommand(command)) {
        testsRun++;
        if (tool.success === 1) testsPassed++;
        else testsFailed++;
      }
      const deleted = extractDeletedFiles(command);
      for (const file of deleted) filesDeleted.add(file);
    }

    if (tool.tool_name === "Agent") agentsSpawned++;

    if (paramStr.includes(".env")) securityFlags.push("env_file_detected");
    if (paramStr.includes("password") || paramStr.includes("secret") || paramStr.includes("token")) {
      securityFlags.push("sensitive_string_detected");
    }
  }

  const timestamps: number[] = [];
  for (const tool of tools) timestamps.push(new Date(tool.timestamp).getTime());
  for (const query of queries) timestamps.push(new Date(query.timestamp).getTime());

  const durationMs = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const totalTokens = queries.reduce((sum, q) => sum + q.total_tokens, 0);
  const totalCostUsd = queries.reduce((sum, q) => sum + q.cost_usd, 0);
  const failedToolCalls = tools.filter((t) => t.success === 0).length;

  return {
    files_touched: Array.from(filesTouched),
    files_created: Array.from(filesCreated),
    files_deleted: Array.from(filesDeleted),
    files_written: Array.from(filesWritten),
    tests_run: testsRun,
    tests_passed: testsPassed,
    tests_failed: testsFailed,
    total_tool_calls: tools.length,
    failed_tool_calls: failedToolCalls,
    total_tokens: totalTokens,
    total_cost_usd: totalCostUsd,
    duration_ms: durationMs,
    agents_spawned: agentsSpawned,
    security_flags: Array.from(new Set(securityFlags)),
  };
}

export function computeFlags(summary: TrustSummary, tools: SessionToolData[]): TrustFlag[] {
  const flags: TrustFlag[] = [];

  for (const tool of tools) {
    const params = tool.parameters ?? "";

    if (params.includes(".env")) {
      flags.push({ severity: "critical", message: "Access to .env file detected", detail: `Tool: ${tool.tool_name}` });
    }
    if (tool.tool_name === "Bash" && params.includes("sudo")) {
      flags.push({ severity: "critical", message: "sudo command detected", detail: "Elevated privileges used" });
    }
    if (tool.tool_name === "Bash" && params.includes("rm -rf")) {
      flags.push({ severity: "critical", message: "Destructive rm -rf command detected", detail: "Force removal of files/directories" });
    }
    if (tool.tool_name === "Bash" && params.includes("chmod 777")) {
      flags.push({ severity: "warning", message: "chmod 777 detected", detail: "Overly permissive file permissions" });
    }
  }

  if (summary.files_deleted.length > 5) {
    flags.push({ severity: "warning", message: "High number of file deletions", detail: `${summary.files_deleted.length} files deleted` });
  }
  if (summary.total_tool_calls > 0) {
    const failureRate = summary.failed_tool_calls / summary.total_tool_calls;
    if (failureRate > 0.3) {
      flags.push({ severity: "warning", message: "High tool failure rate", detail: `${Math.round(failureRate * 100)}% of tool calls failed` });
    }
  }

  return flags;
}

export function scoreTestCoverage(summary: TrustSummary): number {
  const isReadOnly = summary.files_written.length === 0 && summary.files_deleted.length === 0;
  if (isReadOnly) return 100;
  if (summary.tests_run === 0) return 0;
  if (summary.tests_failed === 0) return 100;
  return Math.max(0, Math.round((100 * summary.tests_passed) / summary.tests_run));
}

export function scoreScopeDiscipline(summary: TrustSummary): number {
  const files = summary.files_touched.length;
  if (files <= 2) return 100;
  return Math.max(0, Math.round(100 - 20 * Math.log2(files / 3)));
}

export function scoreErrorRate(summary: TrustSummary): number {
  if (summary.total_tool_calls === 0) return 100;
  return Math.max(0, Math.round(100 - (summary.failed_tool_calls / summary.total_tool_calls) * 100));
}

export function scoreCostEfficiency(summary: TrustSummary): number {
  const successfulCalls = summary.total_tool_calls - summary.failed_tool_calls;
  if (successfulCalls === 0) return 100;
  const tokensPerCall = summary.total_tokens / successfulCalls;
  if (tokensPerCall <= 5000) return 100;
  if (tokensPerCall >= 50000) return 0;
  return Math.round(100 - ((tokensPerCall - 5000) / 45000) * 100);
}

export function scoreSecurity(summary: TrustSummary, flags: TrustFlag[]): number {
  let score = 100;
  for (const flag of flags) {
    if (flag.severity === "critical") {
      if (flag.message.includes("env")) score -= 30;
      else if (flag.message.includes("sudo")) score -= 20;
      else if (flag.message.includes("sensitive") || flag.message.includes("rm -rf")) score -= 20;
      else score -= 10;
    }
  }
  return Math.max(0, score);
}

export function computeTrustScore(
  sessionId: string,
  tools: SessionToolData[],
  queries: SessionQueryData[],
  conversations: SessionConversationData[]
): TrustMetrics {
  const summary = computeSummary(tools, queries, conversations);
  const flags = computeFlags(summary, tools);

  const dimensions: TrustDimensions = {
    test_coverage: scoreTestCoverage(summary),
    scope_discipline: scoreScopeDiscipline(summary),
    error_rate: scoreErrorRate(summary),
    cost_efficiency: scoreCostEfficiency(summary),
    security: scoreSecurity(summary, flags),
  };

  const hasWrites = summary.files_written.length > 0 || summary.files_deleted.length > 0;
  const writeWithoutTests = hasWrites && summary.tests_run === 0;

  const overallScore = writeWithoutTests
    ? Math.round(
        dimensions.test_coverage * 0.40 +
        dimensions.scope_discipline * 0.15 +
        dimensions.error_rate * 0.20 +
        dimensions.cost_efficiency * 0.10 +
        dimensions.security * 0.15
      )
    : Math.round(
        dimensions.test_coverage * 0.30 +
        dimensions.scope_discipline * 0.20 +
        dimensions.error_rate * 0.20 +
        dimensions.cost_efficiency * 0.10 +
        dimensions.security * 0.20
      );

  return {
    session_id: sessionId,
    overall_score: overallScore,
    dimensions,
    summary,
    flags,
  };
}
