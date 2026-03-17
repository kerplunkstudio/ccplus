import { renderHook, waitFor, act } from '@testing-library/react';
import { usePlugins } from './usePlugins';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('usePlugins', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('Load installed plugins', () => {
    it('should load installed plugins successfully', async () => {
      const mockPlugins = [
        { name: 'plugin-1', version: '1.0.0', installed: true },
        { name: 'plugin-2', version: '2.0.0', installed: true },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: mockPlugins }),
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/plugins');
      expect(result.current.installedPlugins).toEqual(mockPlugins);
      expect(result.current.error).toBeNull();
    });

    it('should handle empty installed plugins list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.installedPlugins).toEqual([]);
    });

    it('should handle missing plugins property in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.installedPlugins).toEqual([]);
    });

    it('should handle non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to load installed plugins');
      });

      expect(result.current.installedPlugins).toEqual([]);
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });
    });
  });

  describe('Load marketplace plugins', () => {
    it('should load marketplace plugins without search', async () => {
      const mockPlugins = [
        { name: 'market-plugin-1', version: '1.0.0', installed: false },
        { name: 'market-plugin-2', version: '2.0.0', installed: false },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: mockPlugins }),
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadMarketplace();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/marketplace');
      expect(result.current.marketplacePlugins).toEqual(mockPlugins);
    });

    it('should load marketplace plugins with search query', async () => {
      const mockPlugins = [
        { name: 'search-result', version: '1.0.0', installed: false },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: mockPlugins }),
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadMarketplace('test search');
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/marketplace?search=test%20search');
      expect(result.current.marketplacePlugins).toEqual(mockPlugins);
    });

    it('should handle marketplace load error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadMarketplace();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to load marketplace plugins');
      });
    });

    it('should encode special characters in search query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadMarketplace('test & special');
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/marketplace?search=test%20%26%20special');
    });
  });

  describe('Install plugin', () => {
    it('should install plugin successfully', async () => {
      const mockResult = { success: true, plugin: { name: 'new-plugin', version: '1.0.0' } };

      // Install response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      // Reload installed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      // Reload marketplace
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      let installResult;
      await act(async () => {
        installResult = await result.current.installPlugin('new-plugin');
      });

      expect(installResult).toEqual(mockResult);
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'new-plugin' }),
      });
    });

    it('should reload both lists after successful installation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [{ name: 'installed-plugin' }] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      await act(async () => {
        await result.current.installPlugin('test-plugin');
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/install', expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins');
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/marketplace');
    });

    it('should handle installation failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Installation failed' }),
      });

      const { result } = renderHook(() => usePlugins());

      let installResult;
      await act(async () => {
        installResult = await result.current.installPlugin('bad-plugin');
      });

      expect(installResult.success).toBe(false);
      expect(installResult.error).toBe('Installation failed');
    });

    it('should handle network error during installation', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => usePlugins());

      let installResult;
      await act(async () => {
        installResult = await result.current.installPlugin('network-fail');
      });

      expect(installResult.success).toBe(false);
      expect(installResult.error).toBe('Network error');
    });
  });

  describe('Uninstall plugin', () => {
    it('should uninstall plugin successfully', async () => {
      const mockResult = { success: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      let uninstallResult;
      await act(async () => {
        uninstallResult = await result.current.uninstallPlugin('remove-plugin');
      });

      expect(uninstallResult).toEqual(mockResult);
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/remove-plugin', {
        method: 'DELETE',
      });
    });

    it('should encode plugin name in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      await act(async () => {
        await result.current.uninstallPlugin('plugin with spaces');
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/plugin%20with%20spaces', {
        method: 'DELETE',
      });
    });

    it('should handle uninstallation failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Uninstallation failed' }),
      });

      const { result } = renderHook(() => usePlugins());

      let uninstallResult;
      await act(async () => {
        uninstallResult = await result.current.uninstallPlugin('bad-plugin');
      });

      expect(uninstallResult.success).toBe(false);
      expect(uninstallResult.error).toBe('Uninstallation failed');
    });

    it('should reload both lists after successful uninstallation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      await act(async () => {
        await result.current.uninstallPlugin('test-plugin');
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Get plugin details', () => {
    it('should get plugin details successfully', async () => {
      const mockPlugin = { name: 'detail-plugin', version: '1.0.0', description: 'Test plugin' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlugin,
      });

      const { result } = renderHook(() => usePlugins());

      let plugin;
      await act(async () => {
        plugin = await result.current.getPluginDetails('detail-plugin');
      });

      expect(plugin).toEqual(mockPlugin);
      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/detail-plugin');
    });

    it('should return null for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const { result } = renderHook(() => usePlugins());

      let plugin;
      await act(async () => {
        plugin = await result.current.getPluginDetails('missing-plugin');
      });

      expect(plugin).toBeNull();
    });

    it('should handle non-404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => usePlugins());

      let plugin;
      await act(async () => {
        plugin = await result.current.getPluginDetails('error-plugin');
      });

      expect(plugin).toBeNull();
      expect(result.current.error).toBe('Failed to get plugin details');
    });

    it('should encode plugin name in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'test' }),
      });

      const { result } = renderHook(() => usePlugins());

      await act(async () => {
        await result.current.getPluginDetails('plugin/with/slashes');
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/plugins/plugin%2Fwith%2Fslashes');
    });
  });

  describe('Return shape', () => {
    it('should return correct shape', () => {
      const { result } = renderHook(() => usePlugins());

      expect(result.current).toHaveProperty('installedPlugins');
      expect(result.current).toHaveProperty('marketplacePlugins');
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('loadInstalled');
      expect(result.current).toHaveProperty('loadMarketplace');
      expect(result.current).toHaveProperty('installPlugin');
      expect(result.current).toHaveProperty('uninstallPlugin');
      expect(result.current).toHaveProperty('getPluginDetails');

      expect(typeof result.current.loadInstalled).toBe('function');
      expect(typeof result.current.loadMarketplace).toBe('function');
      expect(typeof result.current.installPlugin).toBe('function');
      expect(typeof result.current.uninstallPlugin).toBe('function');
      expect(typeof result.current.getPluginDetails).toBe('function');
    });
  });

  describe('Loading states', () => {
    it('should set loading state during operations', async () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => usePlugins());

      expect(result.current.loading).toBe(false);

      act(() => {
        result.current.loadInstalled();
      });

      expect(result.current.loading).toBe(true);
    });

    it('should clear loading after operation completes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Error handling', () => {
    it('should clear error when new operation starts', async () => {
      mockFetch.mockRejectedValueOnce(new Error('First error'));

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('First error');
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      });

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });

    it('should handle unknown error types', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      const { result } = renderHook(() => usePlugins());

      act(() => {
        result.current.loadInstalled();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Unknown error');
      });
    });
  });
});
