/**
 * kairos-runner.ts
 *
 * SDK agent runner for KAIROS retrospective analysis.
 * Spawns an Opus query to analyze batches of completed sessions.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { getFleetSession } from "./db/fleet-sessions.js";
import {
  ensureAnalysisRecord,
  markAnalysisStarted,
  markAnalysisCompleted,
  markAnalysisFailed,
  addCorrelation,
  getCorrelationsForSession,
} from "./db/kairos.js";
import {
  buildKairosSystemPrompt,
  buildKairosUserPrompt,
  type KairosSessionInput,
  type KairosBatchInput,
} from "./kairos-prompt.js";
import * as config from "./config.js";
import { homedir } from "os";
import path from "path";
import { existsSync, readdirSync } from "fs";

// ---- Types ----

export interface KairosRunResult {
  readonly analyzed: number;
  readonly correlationsFound: number;
  readonly promptChangesRecommended: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly promptChanges: ReadonlyArray<{
    readonly targetFile: string;
    readonly section: string;
    readonly changeType: string;
    readonly currentText: string;
    readonly proposedText: string;
    readonly reasoning: string;
    readonly evidenceSessionIds: readonly string[];
    readonly confidence: number;
  }>;
}

export interface KairosRunnerDeps {
  readonly log: {
    info: (msg: string, context?: Record<string, unknown>) => void;
    error: (msg: string, context?: Record<string, unknown>) => void;
    warn: (msg: string, context?: Record<string, unknown>) => void;
  };
}

// ---- JSON Output Schema ----

interface KairosJsonOutput {
  batch_summary: {
    total_sessions: number;
    successes: number;
    partial: number;
    failures: number;
    correlations_found: number;
    prompt_changes_recommended: number;
  };
  analyses: Array<{
    session_id: string;
    task_intent: string;
    task_type: string;
    actual_outcome: string;
    outcome_reasoning: string;
    follow_up_needed: boolean;
    correlations?: Array<{
      related_session_id: string;
      relation_type: string;
      confidence: number;
      evidence: string;
    }>;
    root_cause?: string;
    root_cause_detail?: string;
  }>;
  prompt_changes?: Array<{
    target_file: string;
    section: string;
    change_type: string;
    current_text: string;
    proposed_text: string;
    reasoning: string;
    evidence_session_ids: string[];
    confidence: number;
  }>;
}

// ---- Public API ----

/**
 * Run KAIROS analysis on a batch of sessions.
 * Spawns an Opus query, parses JSON output, and saves results to the database.
 */
export async function runKairosAnalysis(
  sessionIds: readonly string[],
  deps: KairosRunnerDeps
): Promise<KairosRunResult> {
  const startTime = Date.now();

  // Gather session data from the database
  const sessions: KairosSessionInput[] = [];
  for (const sessionId of sessionIds) {
    const fleetSession = getFleetSession(sessionId);
    if (!fleetSession) {
      deps.log.warn("Session not found in fleet_sessions, skipping", { sessionId });
      continue;
    }

    sessions.push({
      sessionId: fleetSession.sessionId,
      status: fleetSession.status,
      description: fleetSession.description ?? null,
      workspace: fleetSession.workspace,
      startedAt: fleetSession.startedAt,
      durationMs: fleetSession.durationMs,
      toolCount: fleetSession.toolCount,
      inputTokens: fleetSession.inputTokens,
      outputTokens: fleetSession.outputTokens,
      filesTouched: fleetSession.filesTouched,
      label: fleetSession.label,
    });

    // Ensure analysis record exists
    ensureAnalysisRecord(sessionId);
  }

  if (sessions.length === 0) {
    deps.log.warn("No valid sessions to analyze");
    return {
      analyzed: 0,
      correlationsFound: 0,
      promptChangesRecommended: 0,
      totalTokens: 0,
      durationMs: Date.now() - startTime,
      promptChanges: [],
    };
  }

  // Gather existing correlations to avoid duplicates
  const existingCorrelations = sessions.flatMap((s) =>
    getCorrelationsForSession(s.sessionId).map((c) => ({
      sourceSessionId: c.source_session_id,
      targetSessionId: c.target_session_id,
      relationType: c.relation_type,
    }))
  );

  // Build list of modifiable prompt files
  const modifiablePromptFiles = getModifiablePromptFiles();

  // Build prompts
  const systemPrompt = buildKairosSystemPrompt();
  const userPrompt = buildKairosUserPrompt({
    sessions,
    existingCorrelations,
    modifiablePromptFiles,
  });

  // Mark all sessions as analyzing
  for (const sessionId of sessionIds) {
    markAnalysisStarted(sessionId, config.KAIROS_MODEL);
  }

  deps.log.info("Starting KAIROS analysis", {
    sessionCount: sessions.length,
    model: config.KAIROS_MODEL,
    maxTurns: config.KAIROS_MAX_ANALYSIS_TURNS,
  });

  // Spawn the SDK query
  let jsonOutput: KairosJsonOutput | null = null;
  let totalTokens = 0;

  try {
    const q = query({
      prompt: userPrompt,
      options: {
        model: config.KAIROS_MODEL,
        cwd: config.CAPTAIN_WORKSPACE,
        settingSources: [],
        systemPrompt: {
          type: "text",
          text: systemPrompt,
        } as any,
        maxTurns: config.KAIROS_MAX_ANALYSIS_TURNS,
        includePartialMessages: false,
        permissionMode: config.BYPASS_PERMISSIONS ? ("bypassPermissions" as any) : undefined,
        allowDangerouslySkipPermissions: config.BYPASS_PERMISSIONS,
      },
    });

    // Collect streaming response
    const textBlocks: string[] = [];
    for await (const message of q) {
      if (message.type === "assistant") {
        const msg = message as any;
        for (const block of msg.message?.content ?? []) {
          if (block.type === "text") {
            textBlocks.push(block.text);
          }
        }
      } else if (message.type === "result") {
        const result = message as any;
        const usageObj = result.usage ?? {};
        totalTokens =
          (usageObj.input_tokens || 0) +
          (usageObj.output_tokens || 0) +
          (usageObj.cache_read_input_tokens || 0);
      }
    }

    // Parse the JSON response
    const fullText = textBlocks.join("");
    jsonOutput = parseKairosJson(fullText, deps);
  } catch (error) {
    deps.log.error("KAIROS query failed", { error: String(error) });
    // Mark all sessions as failed
    for (const sessionId of sessionIds) {
      markAnalysisFailed(sessionId, String(error));
    }
    return {
      analyzed: 0,
      correlationsFound: 0,
      promptChangesRecommended: 0,
      totalTokens,
      durationMs: Date.now() - startTime,
      promptChanges: [],
    };
  }

  if (!jsonOutput) {
    deps.log.error("Failed to parse KAIROS JSON output");
    for (const sessionId of sessionIds) {
      markAnalysisFailed(sessionId, "Invalid JSON output");
    }
    return {
      analyzed: 0,
      correlationsFound: 0,
      promptChangesRecommended: 0,
      totalTokens,
      durationMs: Date.now() - startTime,
      promptChanges: [],
    };
  }

  // Process results
  const durationMs = Date.now() - startTime;
  let correlationsFound = 0;

  for (const analysis of jsonOutput.analyses) {
    const sessionId = analysis.session_id;

    // Mark analysis as completed
    markAnalysisCompleted(sessionId, {
      taskIntent: analysis.task_intent,
      actualOutcome: analysis.actual_outcome,
      outcomeReasoning: analysis.outcome_reasoning,
      followUpNeeded: analysis.follow_up_needed,
      correlatedWith: analysis.correlations?.map((c) => c.related_session_id) ?? [],
      promptIssues: [], // Not used in this schema
      recommendations: [], // Not used in this schema
      analysisTokens: totalTokens,
      analysisCostUsd: 0, // Cost tracking not implemented yet
      analysisDurationMs: durationMs,
    });

    // Add correlations
    if (analysis.correlations) {
      for (const correlation of analysis.correlations) {
        addCorrelation({
          sourceSessionId: sessionId,
          targetSessionId: correlation.related_session_id,
          relationType: correlation.relation_type,
          confidence: correlation.confidence,
          evidence: correlation.evidence,
        });
        correlationsFound++;
      }
    }
  }

  const promptChanges =
    jsonOutput.prompt_changes?.map((pc) => ({
      targetFile: pc.target_file,
      section: pc.section,
      changeType: pc.change_type,
      currentText: pc.current_text,
      proposedText: pc.proposed_text,
      reasoning: pc.reasoning,
      evidenceSessionIds: pc.evidence_session_ids,
      confidence: pc.confidence,
    })) ?? [];

  deps.log.info("KAIROS analysis completed", {
    analyzed: jsonOutput.analyses.length,
    correlationsFound,
    promptChangesRecommended: promptChanges.length,
    durationMs,
  });

  return {
    analyzed: jsonOutput.analyses.length,
    correlationsFound,
    promptChangesRecommended: promptChanges.length,
    totalTokens,
    durationMs,
    promptChanges,
  };
}

// ---- Helpers ----

/**
 * Parse the JSON output from KAIROS.
 * Handles malformed JSON by trying to extract JSON from markdown code blocks.
 */
function parseKairosJson(text: string, deps: KairosRunnerDeps): KairosJsonOutput | null {
  let jsonText = text.trim();

  // Try direct parse first
  try {
    return JSON.parse(jsonText) as KairosJsonOutput;
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]) as KairosJsonOutput;
      } catch (error) {
        deps.log.error("Failed to parse JSON from code block", { error: String(error) });
        return null;
      }
    }

    // Try to find JSON object in the text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as KairosJsonOutput;
      } catch (error) {
        deps.log.error("Failed to parse extracted JSON", { error: String(error) });
        return null;
      }
    }

    deps.log.error("No JSON found in KAIROS output");
    return null;
  }
}

/**
 * Get list of modifiable prompt files (agent definitions and captain prompt).
 */
function getModifiablePromptFiles(): string[] {
  const files: string[] = [];

  // Agent definitions in ~/.claude/agents/
  const agentsDir = path.join(homedir(), ".claude", "agents");
  if (existsSync(agentsDir)) {
    const agentFiles = readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(agentsDir, f));
    files.push(...agentFiles);
  }

  // Captain prompt file
  const captainPromptPath = path.join(config.PROJECT_ROOT, "backend-ts", "src", "captain-prompt.ts");
  if (existsSync(captainPromptPath)) {
    files.push(captainPromptPath);
  }

  return files;
}
