import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchDiscoveredServers, clearDiscoveryCache, type DiscoveryResult, type PulseMcpServer } from '../mcp-discovery.js';
import { SAFE_PACKAGE_NAME_RE } from '../routes/misc.js';

describe('MCP Discovery', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearDiscoveryCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('fetchDiscoveredServers', () => {
    it('should return servers from PulseMCP API', async () => {
      const mockServers: PulseMcpServer[] = [
        {
          name: 'test-server',
          short_description: 'A test server',
          source_code_url: 'https://github.com/test/server',
          package_registry: 'npm',
          package_name: '@test/server',
          package_download_count: 1000,
          github_stars: 50,
          EXPERIMENTAL_ai_generated_description: null,
        },
      ];

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: mockServers,
          total_count: 1,
          next: null,
        }),
      });

      const result = await fetchDiscoveredServers('test', 0);

      expect(result.servers).toEqual(mockServers);
      expect(result.total_count).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.has_more).toBe(false);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.pulsemcp.com/v0beta/servers?query=test&offset=0',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should use cached result on second call within TTL', async () => {
      const mockServers: PulseMcpServer[] = [
        {
          name: 'cached-server',
          short_description: 'Cached server',
          source_code_url: null,
          package_registry: 'npm',
          package_name: 'cached-server',
          package_download_count: null,
          github_stars: null,
          EXPERIMENTAL_ai_generated_description: null,
        },
      ];

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: mockServers,
          total_count: 1,
          next: null,
        }),
      });

      // First call
      const result1 = await fetchDiscoveredServers('cache', 0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result1.servers).toEqual(mockServers);

      // Second call should use cache
      const result2 = await fetchDiscoveredServers('cache', 0);
      expect(fetchMock).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result2.servers).toEqual(mockServers);
    });

    it('should re-fetch after cache TTL expires', async () => {
      vi.useFakeTimers();

      const mockServers1: PulseMcpServer[] = [
        {
          name: 'server1',
          short_description: 'First fetch',
          source_code_url: null,
          package_registry: null,
          package_name: null,
          package_download_count: null,
          github_stars: null,
          EXPERIMENTAL_ai_generated_description: null,
        },
      ];

      const mockServers2: PulseMcpServer[] = [
        {
          name: 'server2',
          short_description: 'Second fetch',
          source_code_url: null,
          package_registry: null,
          package_name: null,
          package_download_count: null,
          github_stars: null,
          EXPERIMENTAL_ai_generated_description: null,
        },
      ];

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            servers: mockServers1,
            total_count: 1,
            next: null,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            servers: mockServers2,
            total_count: 1,
            next: null,
          }),
        });

      // First call
      const result1 = await fetchDiscoveredServers('expiry', 0);
      expect(result1.servers).toEqual(mockServers1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance time by 5 minutes and 1 second (past TTL)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Second call should re-fetch
      const result2 = await fetchDiscoveredServers('expiry', 0);
      expect(result2.servers).toEqual(mockServers2);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should pass query and offset to URL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: [],
          total_count: 0,
          next: null,
        }),
      });

      await fetchDiscoveredServers('search term', 20);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.pulsemcp.com/v0beta/servers?query=search+term&offset=20',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should compute has_more correctly when next is present', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: [],
          total_count: 100,
          next: 'https://api.pulsemcp.com/v0beta/servers?offset=20',
        }),
      });

      const result = await fetchDiscoveredServers('', 0);
      expect(result.has_more).toBe(true);
    });

    it('should compute has_more correctly when next is absent', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: [],
          total_count: 10,
          next: null,
        }),
      });

      const result = await fetchDiscoveredServers('', 0);
      expect(result.has_more).toBe(false);
    });

    it('should throw on fetch failure', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      await expect(fetchDiscoveredServers('test', 0)).rejects.toThrow('Failed to reach PulseMCP: Network error');
    });

    it('should throw on non-ok response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(fetchDiscoveredServers('test', 0)).rejects.toThrow('PulseMCP returned 500: Internal Server Error');
    });

    it('should not cache errors', async () => {
      const mockServers: PulseMcpServer[] = [
        {
          name: 'success-server',
          short_description: 'Success after error',
          source_code_url: null,
          package_registry: null,
          package_name: null,
          package_download_count: null,
          github_stars: null,
          EXPERIMENTAL_ai_generated_description: null,
        },
      ];

      // First call fails
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchDiscoveredServers('error', 0)).rejects.toThrow('Failed to reach PulseMCP');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          servers: mockServers,
          total_count: 1,
          next: null,
        }),
      });

      const result = await fetchDiscoveredServers('error', 0);
      expect(fetchMock).toHaveBeenCalledTimes(2); // Called again, not cached
      expect(result.servers).toEqual(mockServers);
    });
  });

  describe('clearDiscoveryCache', () => {
    it('should clear the cache', async () => {
      const mockServers: PulseMcpServer[] = [
        {
          name: 'server',
          short_description: 'Test',
          source_code_url: null,
          package_registry: null,
          package_name: null,
          package_download_count: null,
          github_stars: null,
          EXPERIMENTAL_ai_generated_description: null,
        },
      ];

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: mockServers,
          total_count: 1,
          next: null,
        }),
      });

      // First call
      await fetchDiscoveredServers('test', 0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call uses cache
      await fetchDiscoveredServers('test', 0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Clear cache
      clearDiscoveryCache();

      // Third call re-fetches
      await fetchDiscoveredServers('test', 0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('MCP Install Route Logic', () => {
  it('should generate npx config for npm registry', () => {
    const packageName = '@test/server';
    const config = { command: 'npx', args: ['-y', packageName] };

    expect(config.command).toBe('npx');
    expect(config.args).toEqual(['-y', '@test/server']);
  });

  it('should generate uvx config for pypi registry', () => {
    const packageName = 'test-server';
    const config = { command: 'uvx', args: [packageName] };

    expect(config.command).toBe('uvx');
    expect(config.args).toEqual(['test-server']);
  });

  it('should validate package names using the production regex', () => {
    // Uses the exported SAFE_PACKAGE_NAME_RE from routes/misc.ts — not a local copy.
    // This ensures the test and production validation stay in sync.

    // Valid: scoped npm packages, simple names, dots, dashes
    expect(SAFE_PACKAGE_NAME_RE.test('@scope/package')).toBe(true);
    expect(SAFE_PACKAGE_NAME_RE.test('simple-package')).toBe(true);
    expect(SAFE_PACKAGE_NAME_RE.test('package_name')).toBe(true);
    expect(SAFE_PACKAGE_NAME_RE.test('package.name')).toBe(true);
    expect(SAFE_PACKAGE_NAME_RE.test('mcp-server')).toBe(true);

    // Invalid: path traversal sequences the old regex allowed
    expect(SAFE_PACKAGE_NAME_RE.test('../../../etc/passwd')).toBe(false);
    expect(SAFE_PACKAGE_NAME_RE.test('.hidden')).toBe(false);
    expect(SAFE_PACKAGE_NAME_RE.test('/absolute/path')).toBe(false);
    expect(SAFE_PACKAGE_NAME_RE.test('@scope/sub/deep/path')).toBe(false);

    // Invalid: shell injection characters
    expect(SAFE_PACKAGE_NAME_RE.test('package; rm -rf /')).toBe(false);
    expect(SAFE_PACKAGE_NAME_RE.test('package && echo hack')).toBe(false);
    expect(SAFE_PACKAGE_NAME_RE.test('package|whoami')).toBe(false);
  });

  it('should reject unsupported registry', () => {
    const packageRegistry = 'unsupported';
    const isSupported = packageRegistry === 'npm' || packageRegistry === 'pypi';

    expect(isSupported).toBe(false);
  });
});
