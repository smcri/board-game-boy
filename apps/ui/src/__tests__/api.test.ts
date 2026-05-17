import { describe, it, expect, beforeEach, vi } from 'vitest';
import { API_HEADER_LLM_KEY, API_HEADER_SEARCH_KEY } from '@bgb/shared';
import { createBuild } from '../lib/api';
import { setLlmKey, setSearchKey } from '../lib/storage';

describe('API client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('createBuild', () => {
    it('should attach LLM API key header', async () => {
      const key = 'test-llm-key';
      setLlmKey('openai' as any, key);

      let capturedHeaders: Record<string, string> | null = null;
      global.fetch = vi.fn(async (url, init) => {
        capturedHeaders = (init as any)?.headers || {};
        return new Response(JSON.stringify({ bundle_id: 'bundle-123' }), {
          status: 200,
        });
      });

      await createBuild({
        prompt: 'Chess',
        mode: 'known_game',
        llm_provider: 'openai',
        llm_model: 'gpt-4',
      });

      expect(capturedHeaders?.[API_HEADER_LLM_KEY]).toBe(key);
    });

    it('should attach search API key header when provided', async () => {
      const llmKey = 'test-llm-key';
      const searchKey = 'test-search-key';
      setLlmKey('openai' as any, llmKey);
      setSearchKey('tavily' as any, searchKey);

      let capturedHeaders: Record<string, string> | null = null;
      global.fetch = vi.fn(async (url, init) => {
        capturedHeaders = (init as any)?.headers || {};
        return new Response(JSON.stringify({ bundle_id: 'bundle-123' }), {
          status: 200,
        });
      });

      await createBuild({
        prompt: 'Chess',
        mode: 'known_game',
        llm_provider: 'openai',
        llm_model: 'gpt-4',
        search_provider: 'tavily',
      });

      expect(capturedHeaders?.[API_HEADER_SEARCH_KEY]).toBe(searchKey);
    });

    it('should never include keys in request body', async () => {
      const key = 'test-llm-key';
      setLlmKey('openai' as any, key);

      let capturedBody: any = null;
      global.fetch = vi.fn(async (url, init) => {
        capturedBody = JSON.parse((init as any)?.body || '{}');
        return new Response(JSON.stringify({ bundle_id: 'bundle-123' }), {
          status: 200,
        });
      });

      await createBuild({
        prompt: 'Chess',
        mode: 'known_game',
        llm_provider: 'openai',
        llm_model: 'gpt-4',
      });

      expect(capturedBody).not.toHaveProperty('llm_api_key');
      expect(capturedBody).not.toHaveProperty('api_key');
      expect(JSON.stringify(capturedBody)).not.toContain(key);
    });

    it('should never use Authorization header for API keys', async () => {
      const key = 'test-llm-key';
      setLlmKey('openai' as any, key);

      let capturedHeaders: Record<string, string> | null = null;
      global.fetch = vi.fn(async (url, init) => {
        capturedHeaders = (init as any)?.headers || {};
        return new Response(JSON.stringify({ bundle_id: 'bundle-123' }), {
          status: 200,
        });
      });

      await createBuild({
        prompt: 'Chess',
        mode: 'known_game',
        llm_provider: 'openai',
        llm_model: 'gpt-4',
      });

      expect(capturedHeaders?.['Authorization']).toBeUndefined();
      expect(capturedHeaders?.['authorization']).toBeUndefined();
    });

    it('should use correct header names from shared constants', async () => {
      const llmKey = 'test-llm-key';
      const searchKey = 'test-search-key';
      setLlmKey('openai' as any, llmKey);
      setSearchKey('tavily' as any, searchKey);

      let capturedHeaders: Record<string, string> | null = null;
      global.fetch = vi.fn(async (url, init) => {
        capturedHeaders = (init as any)?.headers || {};
        return new Response(JSON.stringify({ bundle_id: 'bundle-123' }), {
          status: 200,
        });
      });

      await createBuild({
        prompt: 'Chess',
        mode: 'known_game',
        llm_provider: 'openai',
        llm_model: 'gpt-4',
        search_provider: 'tavily',
      });

      // Verify the exact header names from shared.
      expect(capturedHeaders?.[API_HEADER_LLM_KEY]).toBe(llmKey);
      expect(capturedHeaders?.[API_HEADER_SEARCH_KEY]).toBe(searchKey);
    });
  });
});
