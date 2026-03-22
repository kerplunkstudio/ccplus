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
    // Optimistically update local state (immutable pattern)
    setState((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [category]: {
          ...(prev.config?.[category] || {}),
          [key]: value,
        },
      },
    }));

    // POST to backend
    try {
      const response = await fetch(`${SOCKET_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [category]: {
            [key]: value,
          },
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
        const errorText = await response.text();
        setState((prev) => ({
          ...prev,
          error: `Failed to update setting: ${errorText}`,
        }));
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
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
