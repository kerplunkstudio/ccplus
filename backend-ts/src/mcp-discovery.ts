const PULSEMCP_BASE_URL = 'https://api.pulsemcp.com/v0beta';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface PulseMcpServer {
  name: string;
  short_description: string;
  source_code_url: string | null;
  package_registry: string | null;
  package_name: string | null;
  package_download_count: number | null;
  github_stars: number | null;
  EXPERIMENTAL_ai_generated_description: string | null;
}

export interface DiscoveryResult {
  servers: PulseMcpServer[];
  total_count: number;
  offset: number;
  has_more: boolean;
}

// Module-level in-memory cache
const cache = new Map<string, CacheEntry<DiscoveryResult>>();

export function clearDiscoveryCache(): void {
  cache.clear();
}

export async function fetchDiscoveredServers(query: string, offset: number): Promise<DiscoveryResult> {
  const cacheKey = `${query}:${offset}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const params = new URLSearchParams();
  if (query) params.set('query', query);
  params.set('offset', String(offset));

  const url = `${PULSEMCP_BASE_URL}/servers?${params}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    throw new Error(`Failed to reach PulseMCP: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`PulseMCP returned ${response.status}: ${response.statusText}`);
  }

  const json = await response.json() as { servers: PulseMcpServer[]; total_count: number; next?: string | null };
  const result: DiscoveryResult = {
    servers: json.servers,
    total_count: json.total_count,
    offset,
    has_more: !!json.next,
  };

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
