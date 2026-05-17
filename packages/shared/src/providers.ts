// Provider enums. See docs/design/01-overview-and-architecture.md and
// docs/design/04-rules-agent-pipeline.md.

import { z } from 'zod';

export const LlmProvider = z.enum(['openai', 'anthropic', 'ollama', 'groq', 'xai_grok']);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const SearchProvider = z.enum(['tavily', 'brave', 'serpapi']);
export type SearchProvider = z.infer<typeof SearchProvider>;

export const BuildMode = z.enum(['known_game', 'known_with_overrides', 'fully_custom']);
export type BuildMode = z.infer<typeof BuildMode>;

/** Default model per LLM provider. Used when the UI does not supply one. */
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  ollama: 'llama3.1:8b',
  groq: 'llama-3.1-70b-versatile',
  xai_grok: 'grok-2-latest',
};

/** Human-friendly label per provider. Used in dropdowns / status text. */
export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama (local)',
  groq: 'Groq (hardware inference for OSS models)',
  xai_grok: 'xAI Grok',
};

/** Whether the provider needs an API key supplied by the user. */
export const PROVIDER_NEEDS_KEY: Record<LlmProvider, boolean> = {
  openai: true,
  anthropic: true,
  ollama: false,
  groq: true,
  xai_grok: true,
};
