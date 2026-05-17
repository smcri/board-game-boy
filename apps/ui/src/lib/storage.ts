import type { LlmProvider, SearchProvider } from '@bgb/shared';

/**
 * Get the stored LLM API key for a provider.
 * @param provider - The LLM provider name.
 * @returns The API key, or undefined if not found.
 */
export function getLlmKey(provider: LlmProvider): string | undefined {
  const key = `bgb.keys.llm.${provider}`;
  const val = localStorage.getItem(key);
  return val ?? undefined;
}

/**
 * Set the LLM API key for a provider.
 * @param provider - The LLM provider name.
 * @param key - The API key to store.
 */
export function setLlmKey(provider: LlmProvider, key: string): void {
  const storageKey = `bgb.keys.llm.${provider}`;
  localStorage.setItem(storageKey, key);
}

/**
 * Get the stored search provider API key.
 * @param provider - The search provider name.
 * @returns The API key, or undefined if not found.
 */
export function getSearchKey(provider: SearchProvider): string | undefined {
  const key = `bgb.keys.search.${provider}`;
  const val = localStorage.getItem(key);
  return val ?? undefined;
}

/**
 * Set the search provider API key.
 * @param provider - The search provider name.
 * @param key - The API key to store.
 */
export function setSearchKey(provider: SearchProvider, key: string): void {
  const storageKey = `bgb.keys.search.${provider}`;
  localStorage.setItem(storageKey, key);
}

/**
 * Remove all stored API keys from localStorage.
 * Clears all keys matching the bgb.keys.* pattern.
 */
export function forgetAllKeys(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('bgb.keys.')) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((key) => localStorage.removeItem(key));
}
