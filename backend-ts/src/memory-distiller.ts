import path from "path";
import * as database from "./database.js";
import * as config from "./config.js";
import { log } from "./logger.js";

// Debounce tracking: sessionId -> lastDistilledAt timestamp
const distillationTimestamps = new Map<string, number>();

// Cleanup interval for old entries (1 hour)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanup = Date.now();

/**
 * Check if session should be distilled based on debounce rules
 */
export function shouldDistill(sessionId: string): boolean {
  const now = Date.now();

  // Cleanup old entries periodically
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    cleanupOldEntries();
    lastCleanup = now;
  }

  const lastDistilled = distillationTimestamps.get(sessionId);
  if (!lastDistilled) {
    return true;
  }

  const timeSinceLastDistill = now - lastDistilled;
  return timeSinceLastDistill >= config.MEMORY_DISTILL_DEBOUNCE_MS;
}

/**
 * Remove entries older than 1 hour to prevent memory leaks
 */
function cleanupOldEntries(): void {
  const now = Date.now();
  const threshold = now - CLEANUP_INTERVAL_MS;

  for (const [sessionId, timestamp] of distillationTimestamps.entries()) {
    if (timestamp < threshold) {
      distillationTimestamps.delete(sessionId);
    }
  }
}

/**
 * Extract file paths from tool parameters
 */
function extractFilePaths(toolEvents: Record<string, unknown>[]): string[] {
  const filePaths = new Set<string>();

  for (const event of toolEvents) {
    const toolName = event.tool_name as string;
    const params = event.parameters;

    if (!params || typeof params !== "object") {
      continue;
    }

    // Extract file_path from Edit, Write, Read tools
    if (toolName === "Edit" || toolName === "Write" || toolName === "Read") {
      const filePath = (params as { file_path?: string }).file_path;
      if (filePath) {
        filePaths.add(filePath);
      }
    }
  }

  return Array.from(filePaths);
}

/**
 * Extract unique tool names from tool events
 */
function extractToolNames(toolEvents: Record<string, unknown>[]): string[] {
  const toolNames = new Set<string>();

  for (const event of toolEvents) {
    const toolName = event.tool_name as string;
    if (toolName && !toolName.startsWith("toolu_")) {
      toolNames.add(toolName);
    }
  }

  return Array.from(toolNames);
}

/**
 * Extract unique agent types from tool events
 */
function extractAgentTypes(toolEvents: Record<string, unknown>[]): string[] {
  const agentTypes = new Set<string>();

  for (const event of toolEvents) {
    const agentType = event.agent_type as string | null;
    if (agentType) {
      agentTypes.add(agentType);
    }
  }

  return Array.from(agentTypes);
}

/**
 * Extract error messages from failed tool events
 */
function extractErrors(toolEvents: Record<string, unknown>[]): string[] {
  const errors: string[] = [];

  for (const event of toolEvents) {
    const success = event.success;
    const error = event.error as string | null;

    if (success === 0 && error) {
      // Truncate long errors
      const truncated = error.length > 200 ? error.slice(0, 200) + "..." : error;
      errors.push(truncated);
    }
  }

  return errors;
}

/**
 * Truncate text to max length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "...";
}

/**
 * Extract structured knowledge from session and store via memory client
 */
export async function distillSession(
  sessionId: string,
  workspace: string,
  options?: { preCompaction?: boolean }
): Promise<void> {
  try {
    // Check debounce
    if (!shouldDistill(sessionId)) {
      log.debug("Skipping distillation (debounce)", { sessionId });
      return;
    }

    // Gather session data
    const conversations = database.getConversationHistory(sessionId, 1000);
    const toolEvents = database.getToolEvents(sessionId, 1000);

    // Skip if too few messages
    if (conversations.length < config.MEMORY_DISTILL_MIN_MESSAGES) {
      log.debug("Skipping distillation (too few messages)", {
        sessionId,
        messageCount: conversations.length,
      });
      return;
    }

    // Extract first user message (goal)
    const firstUserMessage = conversations.find((msg) => msg.role === "user");
    const goal = firstUserMessage
      ? truncate(firstUserMessage.content as string, 200)
      : "Unknown goal";

    // Extract last assistant message (outcome)
    const lastAssistantMessage = conversations
      .slice()
      .reverse()
      .find((msg) => msg.role === "assistant");
    const outcome = lastAssistantMessage
      ? truncate(lastAssistantMessage.content as string, 500)
      : "No outcome";

    // Extract structured data
    const filePaths = extractFilePaths(toolEvents);
    const toolNames = extractToolNames(toolEvents);
    const agentTypes = extractAgentTypes(toolEvents);
    const errors = extractErrors(toolEvents);

    // Extract project name from workspace path
    const projectName = path.basename(workspace);

    // Format as memory content
    const sections: string[] = [
      `Session ${sessionId} in ${projectName}`,
      `Goal: ${goal}`,
    ];

    if (filePaths.length > 0) {
      sections.push(`Files: ${filePaths.join(", ")}`);
    }

    if (toolNames.length > 0) {
      sections.push(`Tools: ${toolNames.join(", ")}`);
    }

    if (agentTypes.length > 0) {
      sections.push(`Agents: ${agentTypes.join(", ")}`);
    }

    if (errors.length > 0) {
      sections.push(`Errors: ${errors.join("; ")}`);
    }

    sections.push(`Outcome: ${outcome}`);

    const content = sections.join("\n");

    // Build tags
    const tags = [
      `project:${projectName}`,
      `session:${sessionId}`,
      "auto-distill",
    ];

    if (options?.preCompaction) {
      tags.push("pre-compact");
    }

    // Store via memory client
    const { storeMemory } = await import("./memory-client.js");
    await storeMemory(
      content,
      tags.join(","),
      {
        session_id: sessionId,
        workspace,
        message_count: String(conversations.length),
        tool_count: String(toolEvents.length),
      }
    );

    // Update debounce tracking
    distillationTimestamps.set(sessionId, Date.now());

    log.info("Session distilled to memory", {
      sessionId,
      messageCount: conversations.length,
      toolCount: toolEvents.length,
      preCompaction: options?.preCompaction ?? false,
    });
  } catch (error) {
    // Never throw - log and return silently
    log.error("Failed to distill session", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
