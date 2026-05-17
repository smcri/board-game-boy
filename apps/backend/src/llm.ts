/**
 * LLM provider abstraction using LangChain's initChatModel.
 * Supports openai, anthropic, ollama, groq.
 * Each model exposes withStructuredOutput(schema, { name }).
 */
import { initChatModel } from '@langchain/core/language_model/chat_model';
import { BaseChatModel } from '@langchain/core/language_model/chat_model';
import { LlmProvider, PROVIDER_NEEDS_KEY } from '@bgb/shared';
import { logger } from './logger.js';
import { config } from './config.js';

/**
 * Create an LLM instance for the given provider and model.
 */
export async function makeLlm(provider: LlmProvider, model: string, apiKey?: string): Promise<BaseChatModel> {
  const needsKey = PROVIDER_NEEDS_KEY[provider];

  if (needsKey && !apiKey) {
    throw new Error(`API key required for provider: ${provider}`);
  }

  logger.debug({ provider, model }, 'Creating LLM');

  let config_overrides: Record<string, unknown> = {};

  switch (provider) {
    case 'openai':
      if (apiKey) config_overrides.apiKey = apiKey;
      break;
    case 'anthropic':
      if (apiKey) config_overrides.apiKey = apiKey;
      break;
    case 'ollama':
      // Ollama runs locally; use OLLAMA_BASE_URL from env
      config_overrides.baseUrl = config.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
      break;
    case 'groq':
      if (apiKey) config_overrides.apiKey = apiKey;
      // TODO: @langchain/groq may not be available; verify on install
      break;
  }

  const llm = await initChatModel(model, {
    modelProvider: provider,
    ...config_overrides,
  });

  return llm;
}

/**
 * Helper to create an LLM with structured output support.
 * Wraps the model's withStructuredOutput method.
 */
export function withStructuredOutput(llm: BaseChatModel, schema: unknown, opts: { name: string }) {
  if ('withStructuredOutput' in llm && typeof llm.withStructuredOutput === 'function') {
    return (llm as any).withStructuredOutput(schema, opts);
  }
  throw new Error(`LLM ${llm.constructor.name} does not support withStructuredOutput`);
}
