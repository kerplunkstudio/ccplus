// ---- Skills discovery (cached) ----

export interface SkillInfo {
  name: string;
  plugin: string;
  description: string;
}

// ---- Types ----

export interface SessionCallbacks {
  onText: (text: string, messageIndex: number) => void;
  onToolEvent: (event: Record<string, unknown>) => void;
  onComplete: (result: Record<string, unknown>) => void;
  onError: (message: string) => void;
  onUserQuestion?: (data: Record<string, unknown>) => void;
  onThinkingDelta?: (text: string) => void;
  onSignal?: (signal: { type: string; data: Record<string, unknown> }) => void;
  onToolProgress?: (data: { tool_use_id: string; elapsed_seconds: number }) => void;
  onRateLimit?: (data: { retryAfterMs: number; rateLimitedAt: string }) => void;
  onPromptSuggestion?: (suggestions: string[]) => void;
  onCompactBoundary?: () => void;
  onDevServerDetected?: (url: string) => void;
  onCaptureScreenshot?: () => Promise<{ image?: string; url?: string; error?: string }>;
}

export interface ActiveSession {
  sessionId: string;
  workspace: string;
  model: string | null;
  sdkSessionId: string | null;
  activeQuery: any | null;
  callbacks: SessionCallbacks | null;
  cancelRequested: boolean;
  pendingQuestion: {
    resolve: (value: Record<string, unknown>) => void;
    data: Record<string, unknown>;
  } | null;
  questionTimeout: NodeJS.Timeout | null;
  streamingContent: string;
  latestTodos: Array<{ content: string; status: string; priority?: string }> | null;
  hadToolSinceLastText: boolean;
}
