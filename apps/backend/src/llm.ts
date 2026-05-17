/**
 * LLM provider abstraction using per-provider classes.
 * Supports openai, anthropic, ollama, groq.
 * Each model exposes withStructuredOutput(schema, { name }).
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/community/chat_models/ollama';
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

  switch (provider) {
    case 'openai':
      return new ChatOpenAI({
        modelName: model,
        apiKey: apiKey || process.env.OPENAI_API_KEY,
      });

    case 'anthropic':
      return new ChatAnthropic({
        modelName: model,
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
      });

    case 'ollama':
      return new ChatOllama({
        model,
        baseUrl: config.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      });

    case 'groq':
      // Groq exposes an OpenAI-compatible Chat Completions API, so we reuse
      // ChatOpenAI with a custom baseURL. This avoids depending on the
      // (currently unstable) @langchain/groq package.
      return new ChatOpenAI({
        modelName: model,
        apiKey: apiKey || process.env.GROQ_API_KEY,
        configuration: {
          baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        },
      });

    case 'xai_grok':
      // xAI also exposes an OpenAI-compatible API at https://api.x.ai/v1.
      // Same trick as Groq: route through ChatOpenAI with a custom baseURL.
      return new ChatOpenAI({
        modelName: model,
        apiKey: apiKey || process.env.XAI_API_KEY,
        configuration: {
          baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
        },
      });

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
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
