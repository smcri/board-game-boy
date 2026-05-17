/**
 * Search implementations: Tavily, Brave, SerpAPI.
 * Each returns SearchHit[] { url, title?, snippet? }.
 * Uses undici.fetch with 10s timeout.
 */
import { fetch } from 'undici';
import { SearchProvider } from '@bgb/shared';
import { logger } from '../logger.js';

export interface SearchHit {
  url: string;
  title?: string;
  snippet?: string;
}

const TIMEOUT_MS = 10000;

/**
 * Run a search against the specified provider.
 */
export async function runSearch(provider: SearchProvider, key: string, query: string): Promise<SearchHit[]> {
  if (!key) {
    throw new Error(`API key required for search provider: ${provider}`);
  }

  logger.debug({ provider, query }, 'Running search');

  switch (provider) {
    case 'tavily':
      return tavilySearch(key, query);
    case 'brave':
      return braveSearch(key, query);
    case 'serpapi':
      return serpApiSearch(key, query);
  }
}

/**
 * Tavily API: POST /api/search with JSON body.
 */
async function tavilySearch(apiKey: string, query: string): Promise<SearchHit[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, topic: 'general' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { results?: Array<{ url: string; title?: string; snippet?: string }> };
  return (data.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.snippet,
  }));
}

/**
 * Brave Search API: GET /res/v1/web/search.
 */
async function braveSearch(apiKey: string, query: string): Promise<SearchHit[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '20');

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    web?: Array<{ url: string; title?: string; description?: string }>;
  };
  return (data.web ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.description,
  }));
}

/**
 * SerpAPI: GET /search.
 */
async function serpApiSearch(apiKey: string, query: string): Promise<SearchHit[]> {
  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('num', '20');

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`SerpAPI search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    organic_results?: Array<{ link: string; title?: string; snippet?: string }>;
  };
  return (data.organic_results ?? []).map((r) => ({
    url: r.link,
    title: r.title,
    snippet: r.snippet,
  }));
}
