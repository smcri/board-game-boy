import { useState, useCallback } from 'react';
import type { LlmProvider, SearchProvider } from '@bgb/shared';
import { getLlmKey, setLlmKey, getSearchKey, setSearchKey, forgetAllKeys } from './storage';

/**
 * Hook to manage API keys in localStorage.
 * Returns getter/setter functions and forget function for both LLM and search keys.
 */
export function useKeys() {
  const [, setRefresh] = useState(0);

  const llmKey = useCallback((provider: LlmProvider) => getLlmKey(provider), []);
  const searchKey = useCallback((provider: SearchProvider) => getSearchKey(provider), []);

  const hasLlmKey = useCallback((provider: LlmProvider) => !!getLlmKey(provider), []);
  const hasSearchKey = useCallback((provider: SearchProvider) => !!getSearchKey(provider), []);

  const setLlmKeyValue = useCallback((provider: LlmProvider, key: string) => {
    setLlmKey(provider, key);
    setRefresh((r) => r + 1); // Trigger re-render.
  }, []);

  const setSearchKeyValue = useCallback((provider: SearchProvider, key: string) => {
    setSearchKey(provider, key);
    setRefresh((r) => r + 1);
  }, []);

  const forget = useCallback(() => {
    forgetAllKeys();
    setRefresh((r) => r + 1);
  }, []);

  return {
    llmKey,
    searchKey,
    hasLlmKey,
    hasSearchKey,
    setLlmKey: setLlmKeyValue,
    setSearchKey: setSearchKeyValue,
    forget,
  };
}
