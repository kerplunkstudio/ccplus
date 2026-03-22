import { useState, useEffect, useCallback } from 'react';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface SettingsState {
  config: Record<string, any> | null;
  loading: boolean;
  error: string | null;
  restartRequired: boolean;
}

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    config: null,
    loading: true,
    error: null,
    restartRequired: false,
  });

  // Fetch config on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${SOCKET_URL}/api/config`);
        if (response.ok) {
          const data = await response.json();
          setState({
            config: data,
            loading: false,
            error: null,
            restartRequired: false,
          });
        } else if (response.status === 404) {
          // Endpoint not yet implemented - treat as "no config yet"
          setState({
            config: {},
            loading: false,
            error: null,
            restartRequired: false,
          });
        } else {
          const errorText = await response.text();
          setState({
            config: null,
            loading: false,
            error: `Failed to load config: ${errorText}`,
            restartRequired: false,
          });
        }
      } catch (err) {
        setState({
          config: null,
          loading: false,
          error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
          restartRequired: false,
        });
      }
    };

    fetchConfig();
  }, []);

  const updateSetting = useCallback(async (category: string, key: string, value: any) => {
    // Helper to expand dot-notation keys into nested objects
    function expandDotKey(key: string, value: unknown): Record<string, unknown> {
      const parts = key.split('.');
      if (parts.length === 1) return { [key]: value };
      let result: Record<string, unknown> = { [parts[parts.length - 1]]: value };
      for (let i = parts.length - 2; i >= 0; i--) {
        result = { [parts[i]]: result };
      }
      return result;
    }

    // Helper to deep merge two objects
    function deepMerge(target: any, source: any): any {
      const output = { ...target };
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          output[key] = deepMerge(target[key] || {}, source[key]);
        } else {
          output[key] = source[key];
        }
      }
      return output;
    }

    // Capture previous config for rollback
    let prevConfig: Record<string, any> | null = null;

    // Optimistically update local state (immutable pattern with deep merge)
    setState((prev) => {
      prevConfig = prev.config;
      const expanded = expandDotKey(key, value);
      const newCategoryData = deepMerge(prev.config?.[category] || {}, expanded);

      return {
        ...prev,
        config: {
          ...prev.config,
          [category]: newCategoryData,
        },
      };
    });

    // POST to backend
    try {
      const expanded = expandDotKey(key, value);
      const response = await fetch(`${SOCKET_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [category]: expanded,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Update restart required flag if backend indicates it
        if (data.restart_required) {
          setState((prev) => ({
            ...prev,
            restartRequired: true,
          }));
        }
      } else if (response.status === 404) {
        // Endpoint not yet implemented - silently succeed (optimistic update already applied)
        // No error shown to user
      } else {
        // Rollback to previous config on error
        const errorText = await response.text();
        setState((prev) => ({
          ...prev,
          config: prevConfig,
          error: `Failed to update setting: ${errorText}`,
        }));
      }
    } catch (err) {
      // Rollback to previous config on error
      setState((prev) => ({
        ...prev,
        config: prevConfig,
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }, []);

  return {
    config: state.config,
    loading: state.loading,
    error: state.error,
    restartRequired: state.restartRequired,
    updateSetting,
  };
}
