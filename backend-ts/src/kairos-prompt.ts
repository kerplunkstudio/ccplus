/**
 * kairos-prompt.ts
 *
 * System and user prompt builder for the KAIROS retrospective analysis agent.
 * Structures session batch data and prompt file lists for Opus analysis.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import path from "path";
import { log } from "./logger.js";

// ---- Types ----

export interface KairosSessionInput {
  readonly sessionId: string;
  readonly status: string;
  readonly description: string | null;
  readonly workspace: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly toolCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly filesTouched: string[];
  readonly label: string | null;
}

export interface KairosBatchInput {
  readonly sessions: readonly KairosSessionInput[];
  readonly existingCorrelations: ReadonlyArray<{
    readonly sourceSessionId: string;
    readonly targetSessionId: string;
    readonly relationType: string;
  }>;
  readonly modifiablePromptFiles: readonly string[];
}

// ---- Prompt Builders ----

/**
 * Build the static system prompt for KAIROS.
 * Reads the kairos.md agent definition and uses it as the base.
 */
export function buildKairosSystemPrompt(): string {
  const agentFilePath = path.join(homedir(), ".claude", "agents", "kairos.md");

  if (!existsSync(agentFilePath)) {
    log.warn("kairos.md agent definition not found, using fallback prompt", { path: agentFilePath });
    return buildFallbackSystemPrompt();
  }

  try {
    const content = readFileSync(agentFilePath, "utf-8");
    // Strip frontmatter (everything between --- and ---)
    const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, "");
    return withoutFrontmatter.trim();
  } catch (error) {
    log.error("Failed to read kairos.md, using fallback", { error: String(error) });
    return buildFallbackSystemPrompt();
  }
}

/**
 * Fallback system prompt if kairos.md is not available.
 */
function buildFallbackSystemPrompt(): string {
  return `
You are KAIROS, the retrospective learning agent for cc+. You analyze batches of completed SDK sessions to find patterns of failure and recommend improvements to agent prompts, workflow prompts, and the Captain prompt.

## Your Mission

You receive a batch of session data. For each session, you must:
1. Determine what the task was trying to accomplish
2. Assess whether it actually succeeded
3. Identify if follow-up bug fixes were needed
4. Correlate sessions in causal chains
5. When failures trace to prompt deficiencies, recommend specific prompt changes

## Output Format

You MUST respond with a valid JSON object. No markdown fencing, no explanation outside the JSON.

See the user prompt for the exact schema.
  `.trim();
}

/**
 * Build the user prompt with batch data serialized for analysis.
 */
export function buildKairosUserPrompt(input: KairosBatchInput): string {
  const { sessions, existingCorrelations, modifiablePromptFiles } = input;

  const sessionSummaries = sessions.map((s) => {
    const duration = formatDuration(s.durationMs);
    const filesChanged = s.filesTouched.length > 0 ? s.filesTouched.join(", ") : "none";
    const labelStr = s.label ? ` [${s.label}]` : "";

    return `
### Session: ${s.sessionId}${labelStr}
- **Status**: ${s.status}
- **Description**: ${s.description ?? "No description"}
- **Workspace**: ${s.workspace}
- **Started**: ${s.startedAt}
- **Duration**: ${duration}
- **Tools Used**: ${s.toolCount}
- **Tokens**: ${s.inputTokens} in, ${s.outputTokens} out
- **Files Touched**: ${filesChanged}
    `.trim();
  }).join("\n\n");

  const correlationSection = existingCorrelations.length > 0
    ? `
## Existing Correlations

These correlations have already been recorded. Do NOT duplicate them:

${existingCorrelations.map((c) => `- ${c.sourceSessionId} → ${c.targetSessionId} (${c.relationType})`).join("\n")}
    `.trim()
    : "";

  const promptFilesSection = modifiablePromptFiles.length > 0
    ? `
## Modifiable Prompt Files

You may recommend changes to these files:

${modifiablePromptFiles.map((f) => `- ${f}`).join("\n")}
    `.trim()
    : "";

  return `
# Batch Analysis Request

Analyze the following batch of ${sessions.length} sessions.

## Sessions

${sessionSummaries}

${correlationSection}

${promptFilesSection}

## Instructions

For each session:
1. Determine the task intent and classify the task type
2. Assess the actual outcome (success, partial, failure)
3. Identify correlations with other sessions in this batch
4. If the session failed or needed follow-up fixes, perform root cause analysis
5. For prompt deficiencies, recommend specific changes (maximum 3 per batch, confidence >= 0.6)

Respond with a single JSON object following the schema in your system prompt. No markdown fencing, no explanation outside the JSON.
  `.trim();
}

/**
 * Format duration in milliseconds as a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
