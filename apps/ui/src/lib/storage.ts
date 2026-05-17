import type { LlmProvider, SearchProvider } from '@bgb/shared';

/**
 * Defence-in-depth normalisation for stored API keys.
 * Mirrors the input-level normaliser in SettingsPanel so a key written by any
 * code path is always safe to put into an HTTP header.
 */
function normalize(raw: string): string {
  return raw
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ')
    .trim();
}

/**
 * Normalise free-form user text (prompts, custom_rules) before sending to the
 * backend. Less aggressive than the key normaliser: preserves newlines and
 * tabs because users may genuinely want them, but strips zero-width and BOM
 * characters and converts smart quotes / dashes to ASCII so the rules-agent
 * sees clean text.
 */
export function normalizeUserText(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, ' ');
}

/**
 * Get the stored LLM API key for a provider.
 * @param provider - The LLM provider name.
 * @returns The API key, or undefined if not found.
 */
export function getLlmKey(provider: LlmProvider): string | undefined {
  const key = `bgb.keys.llm.${provider}`;
  const val = localStorage.getItem(key);
  // Defence in depth — strip any stray whitespace / CR / LF that might have
  // been pasted from a clipboard. HTTP header values reject these.
  return val ? val.trim() : undefined;
}

/**
 * Set the LLM API key for a provider.
 * @param provider - The LLM provider name.
 * @param key - The API key to store.
 */
export function setLlmKey(provider: LlmProvider, key: string): void {
  const storageKey = `bgb.keys.llm.${provider}`;
  localStorage.setItem(storageKey, normalize(key));
}

/**
 * Get the stored search provider API key.
 * @param provider - The search provider name.
 * @returns The API key, or undefined if not found.
 */
export function getSearchKey(provider: SearchProvider): string | undefined {
  const key = `bgb.keys.search.${provider}`;
  const val = localStorage.getItem(key);
  return val ? val.trim() : undefined;
}

/**
 * Set the search provider API key.
 * @param provider - The search provider name.
 * @param key - The API key to store.
 */
export function setSearchKey(provider: SearchProvider, key: string): void {
  const storageKey = `bgb.keys.search.${provider}`;
  localStorage.setItem(storageKey, normalize(key));
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
