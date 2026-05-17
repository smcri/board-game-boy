import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLlmKey,
  setLlmKey,
  getSearchKey,
  setSearchKey,
  forgetAllKeys,
} from '../lib/storage';

describe('Storage utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('LLM key management', () => {
    it('should store and retrieve LLM API key', () => {
      const provider = 'openai';
      const key = 'sk-test-key-123';

      setLlmKey(provider as any, key);
      expect(getLlmKey(provider as any)).toBe(key);
    });

    it('should return undefined for missing LLM key', () => {
      expect(getLlmKey('openai' as any)).toBeUndefined();
    });

    it('should store keys under namespaced localStorage key', () => {
      setLlmKey('openai' as any, 'test-key');
      const stored = localStorage.getItem('bgb.keys.llm.openai');
      expect(stored).toBe('test-key');
    });
  });

  describe('Search key management', () => {
    it('should store and retrieve search API key', () => {
      const provider = 'tavily';
      const key = 'search-key-456';

      setSearchKey(provider as any, key);
      expect(getSearchKey(provider as any)).toBe(key);
    });

    it('should return undefined for missing search key', () => {
      expect(getSearchKey('tavily' as any)).toBeUndefined();
    });
  });

  describe('Forget all keys', () => {
    it('should clear all stored keys', () => {
      setLlmKey('openai' as any, 'llm-key');
      setLlmKey('anthropic' as any, 'llm-key-2');
      setSearchKey('tavily' as any, 'search-key');

      forgetAllKeys();

      expect(getLlmKey('openai' as any)).toBeUndefined();
      expect(getLlmKey('anthropic' as any)).toBeUndefined();
      expect(getSearchKey('tavily' as any)).toBeUndefined();
    });

    it('should not affect other localStorage keys', () => {
      localStorage.setItem('other-key', 'other-value');
      setLlmKey('openai' as any, 'llm-key');

      forgetAllKeys();

      expect(localStorage.getItem('other-key')).toBe('other-value');
      expect(getLlmKey('openai' as any)).toBeUndefined();
    });
  });
});
