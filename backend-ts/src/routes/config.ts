import type { Express, Request, Response } from "express";
import { z } from "zod";
import * as config from "../config.js";

// Validation schema for settings updates
const settingsUpdateSchema = z.object({
  models: z.object({
    sdk_model: z.string().optional(),
    captain_model: z.string().optional(),
    memory_distill_model: z.string().optional(),
    agent_overrides: z.record(z.string(), z.string()).optional(),
  }).optional(),
  sessions: z.object({
    workspace_path: z.string().optional(),
    bypass_permissions: z.boolean().optional(),
  }).optional(),
  memory: z.object({
    enabled: z.boolean().optional(),
    distillation_enabled: z.boolean().optional(),
    max_inject_tokens: z.number().int().positive().optional(),
    max_search_results: z.number().int().positive().optional(),
    search_timeout_ms: z.number().int().positive().optional(),
    distill_debounce_ms: z.number().int().positive().optional(),
    distill_min_messages: z.number().int().positive().optional(),
  }).optional(),
  workflow: z.object({
    enforcement_enabled: z.boolean().optional(),
    worktrees_enabled: z.boolean().optional(),
    code_review_gate: z.boolean().optional(),
    test_coverage_gate: z.boolean().optional(),
  }).optional(),
  captain: z.object({
    auto_start: z.boolean().optional(),
    resume_on_startup: z.boolean().optional(),
    workspace_path: z.string().optional(),
    allow_edits: z.boolean().optional(),
    allow_bash: z.boolean().optional(),
  }).optional(),
  integrations: z.object({
    telegram: z.object({
      bot_token: z.string().optional(),
      allowed_users: z.array(z.string()).optional(),
      typing_interval_ms: z.number().int().positive().optional(),
    }).optional(),
    discord: z.object({
      bot_token: z.string().optional(),
      allowed_users: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
}).partial();

export function createConfigRoutes(app: Express): void {
  /**
   * GET /api/config
   * Returns all current resolved config (redacts secrets)
   */
  app.get("/api/config", (_req: Request, res: Response) => {
    try {
      const resolvedConfig = config.getResolvedConfig();
      res.json(resolvedConfig);
    } catch (error) {
      res.status(500).json({ error: `Failed to get config: ${String(error)}` });
    }
  });

  /**
   * POST /api/config
   * Accepts partial updates to settings
   * Returns: { success: true, config: <redacted full config>, restart_required: boolean }
   */
  app.post("/api/config", (req: Request, res: Response) => {
    try {
      // Validate request body
      const parseResult = settingsUpdateSchema.safeParse(req.body);

      if (!parseResult.success) {
        res.status(400).json({
          error: "Invalid settings format",
          details: parseResult.error.format(),
        });
        return;
      }

      // Save settings (cast to satisfy TypeScript - Zod validation ensures type safety)
      const { restart_required } = config.saveSettings(parseResult.data as any);

      // Return updated config
      const updatedConfig = config.getResolvedConfig();
      res.json({
        success: true,
        config: updatedConfig,
        restart_required,
      });
    } catch (error) {
      res.status(500).json({ error: `Failed to save settings: ${String(error)}` });
    }
  });
}
