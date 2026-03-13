import { useState, useCallback } from 'react';
import {
  Plugin,
  PluginInstallResult,
  PluginUninstallResult,
} from '../types';

const API_BASE = '';

interface UsePluginsReturn {
  installedPlugins: Plugin[];
  marketplacePlugins: Plugin[];
  loading: boolean;
  error: string | null;
  loadInstalled: () => Promise<void>;
  loadMarketplace: (search?: string) => Promise<void>;
  installPlugin: (identifier: string) => Promise<PluginInstallResult>;
  uninstallPlugin: (name: string) => Promise<PluginUninstallResult>;
  getPluginDetails: (name: string) => Promise<Plugin | null>;
}

export function usePlugins(): UsePluginsReturn {
  const [installedPlugins, setInstalledPlugins] = useState<Plugin[]>([]);
  const [marketplacePlugins, setMarketplacePlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadInstalled = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/plugins`);
      if (!response.ok) {
        throw new Error('Failed to load installed plugins');
      }
      const data = await response.json();
      setInstalledPlugins(data.plugins || []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMarketplace = useCallback(async (search?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = search
        ? `${API_BASE}/api/plugins/marketplace?search=${encodeURIComponent(search)}`
        : `${API_BASE}/api/plugins/marketplace`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to load marketplace plugins');
      }
      const data = await response.json();
      setMarketplacePlugins(data.plugins || []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  const installPlugin = useCallback(
    async (identifier: string): Promise<PluginInstallResult> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/plugins/install`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ identifier }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Installation failed');
        }

        // Reload both lists after installation
        await Promise.all([loadInstalled(), loadMarketplace()]);

        return data;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        setLoading(false);
      }
    },
    [loadInstalled, loadMarketplace]
  );

  const uninstallPlugin = useCallback(
    async (name: string): Promise<PluginUninstallResult> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Uninstallation failed');
        }

        // Reload both lists after uninstallation
        await Promise.all([loadInstalled(), loadMarketplace()]);

        return data;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        setLoading(false);
      }
    },
    [loadInstalled, loadMarketplace]
  );

  const getPluginDetails = useCallback(
    async (name: string): Promise<Plugin | null> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(name)}`);

        if (!response.ok) {
          if (response.status === 404) {
            return null;
          }
          throw new Error('Failed to get plugin details');
        }

        const plugin = await response.json();
        return plugin;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    installedPlugins,
    marketplacePlugins,
    loading,
    error,
    loadInstalled,
    loadMarketplace,
    installPlugin,
    uninstallPlugin,
    getPluginDetails,
  };
}
