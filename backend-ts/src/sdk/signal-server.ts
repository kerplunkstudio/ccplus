import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SessionCallbacks } from "./types.js";

// ---- MCP Signal Server ----

export function buildSignalServer(sessionId: string, callbacks: SessionCallbacks) {
  return createSdkMcpServer({
    name: "ccplus-signals",
    version: "1.0.0",
    tools: [
      tool(
        "emit_status",
        "Report your current work phase to the cc+ UI. Call this when transitioning between phases (planning, implementing, testing, etc.)",
        {
          phase: z.enum(["planning", "implementing", "testing", "reviewing", "debugging", "researching"]),
          detail: z.string().optional(),
        },
        async (args) => {
          callbacks.onSignal?.({ type: "status", data: args });
          return { content: [{ type: "text" as const, text: "Status reported." }] };
        },
      ),
      tool(
        "VerifyApp",
        "Take a screenshot of the running web application in the browser tab. Use this to verify visual changes, check layouts, and inspect the UI. Returns a screenshot image of the app.",
        {
          url: z.string().optional().describe("Optional specific URL to verify. If not provided, captures the current page."),
        },
        async (args) => {
          if (!callbacks.onCaptureScreenshot) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Screenshot capability not available. No browser tab is open or the app is running in a non-Electron environment.",
                },
              ],
            };
          }

          try {
            const result = await callbacks.onCaptureScreenshot();

            if (result.error) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error capturing screenshot: ${result.error}`,
                  },
                ],
              };
            }

            if (!result.image) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Error: No image data returned from browser tab.",
                  },
                ],
              };
            }

            // Return both text description and the image
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Screenshot captured of ${result.url || "browser tab"}. The image shows the current state of the web application.`,
                },
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: result.image,
                  },
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Failed to capture screenshot: ${String(error)}`,
                },
              ],
            };
          }
        },
      ),
    ],
  });
}
