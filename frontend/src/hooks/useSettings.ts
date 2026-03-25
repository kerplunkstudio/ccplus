import { useState, useEffect, useCallback } from 'react';

export interface ModelsConfig {
  defaultModel: string;
  captainModel: string;
  agent_overrides: Record<string, string>;
}

export interface SessionsConfig {
  workspacePath: string;
  bypassPermissions: boolean;
}

export interface MemoryConfig {
  enabled: boolean;
  distillationEnabled: boolean;
  maxInjectTokens: number;
  maxSearchResults: number;
  searchTimeout: number;
  distillDebounce: number;
  minMessages: number;
}

export interface WorkflowConfig {
  workflowEnforcement: boolean;
  worktreesEnabled: boolean;
}

export interface CaptainConfig {
  autoStart: boolean;
  resumeOnStartup: boolean;
  captainWorkspace: string;
  allowEdits: boolean;
  allowBash: boolean;
}

export interface IntegrationsConfig {
  telegram: {
    botToken: string;
    allowedUsers: string[];
    typingInterval: number;
  };
  discord: {
    botToken: string;
    allowedUsers: string[];
  };
}

export interface AppConfig {
  models: ModelsConfig;
  sessions: SessionsConfig;
  memory: MemoryConfig;
  workflow: WorkflowConfig;
  captain: CaptainConfig;
  integrations: IntegrationsConfig;
}

const DEFAULT_CONFIG: AppConfig = {
  models: {
    defaultModel: 'claude-sonnet-4.5-20250929',
    captainModel: 'claude-sonnet-4.5-20250929',
    agent_overrides: {
      code_agent: 'inherit',
      explore: 'inherit',
      'code-reviewer': 'inherit',
      orchestrator: 'inherit',
    },
  },
  sessions: {
    workspacePath: '~/Workspace',
    bypassPermissions: false,
  },
  memory: {
    enabled: true,
    distillationEnabled: true,
    maxInjectTokens: 4000,
    maxSearchResults: 10,
    searchTimeout: 5000,
    distillDebounce: 30000,
    minMessages: 3,
  },
  workflow: {
    workflowEnforcement: true,
    worktreesEnabled: true,
  },
  captain: {
    autoStart: false,
    resumeOnStartup: false,
    captainWorkspace: '~/captain-workspace',
    allowEdits: true,
    allowBash: true,
  },
  integrations: {
    telegram: {
      botToken: '',
      allowedUsers: [],
      typingInterval: 3000,
    },
    discord: {
      botToken: '',
      allowedUsers: [],
    },
  },
};

export function useSettings() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch('/api/config');
        if (!response.ok) {
          throw new Error(`Failed to fetch config: ${response.statusText}`);
        }
        const data = await response.json();
        setConfig(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setConfig(DEFAULT_CONFIG);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  const updateConfig = useCallback(async (key: string, value: unknown) => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update config: ${response.statusText}`);
      }

      const result = await response.json();

      setConfig((prev) => {
        const keys = key.split('.');

        // Helper function to create a deep copy and update the nested value
        const updateNested = (obj: Record<string, unknown>, keyPath: string[], newValue: unknown): Record<string, unknown> => {
          if (keyPath.length === 1) {
            return { ...obj, [keyPath[0]]: newValue };
          }

          const [first, ...rest] = keyPath;
          const currentValue = obj[first];

          return {
            ...obj,
            [first]: updateNested(
              currentValue as Record<string, unknown>,
              rest,
              newValue
            ),
          };
        };

        return updateNested(prev as unknown as Record<string, unknown>, keys, value) as unknown as AppConfig;
      });

      if (result.needsRestart) {
        setNeedsRestart(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update setting');
    }
  }, []);

  return {
    config,
    loading,
    error,
    needsRestart,
    updateConfig,
  };
}
