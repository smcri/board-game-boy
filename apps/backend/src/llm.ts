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
/**
 * Create a chat model for the given provider.
 *
 * @param temperature  Sampling temperature; defaults to 0 for deterministic
 *                     structured-output extraction. Pass 0.5–0.9 for creative
 *                     work (theme generation, UI copy) where variety is desired.
 */
export async function makeLlm(
  provider: LlmProvider,
  model: string,
  apiKey?: string,
  temperature: number = 0,
): Promise<BaseChatModel> {
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
        temperature,
      });

    case 'anthropic':
      return new ChatAnthropic({
        modelName: model,
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        temperature,
      });

    case 'ollama':
      return new ChatOllama({
        model,
        baseUrl: config.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        temperature,
      });

    case 'groq':
      // Groq exposes an OpenAI-compatible Chat Completions API, so we reuse
      // ChatOpenAI with a custom baseURL. This avoids depending on the
      // (currently unstable) @langchain/groq package.
      return new ChatOpenAI({
        modelName: model,
        apiKey: apiKey || process.env.GROQ_API_KEY,
        temperature,
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
        temperature,
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
 *
 * First tries the model's native withStructuredOutput (function-calling /
 * JSON-mode), then falls back to a manual JSON-prompt-and-parse path for
 * providers that advertise the method but don't actually implement it
 * end-to-end (we hit this with xAI Grok via ChatOpenAI baseURL).
 *
 * Returns an object with `.invoke(messages)` that resolves to either the
 * parsed Zod-validated object or a ZodError — matching what the rules-agent
 * already expects.
 */
export function withStructuredOutput(
  llm: BaseChatModel,
  schema: unknown,
  opts: { name: string },
) {
  if ('withStructuredOutput' in llm && typeof llm.withStructuredOutput === 'function') {
    const native = (llm as any).withStructuredOutput(schema, opts);
    return wrapWithJsonFallback(native, llm, schema);
  }
  throw new Error(`LLM ${llm.constructor.name} does not support withStructuredOutput`);
}

/**
 * Wrap a native structured-output runnable so a runtime failure (e.g. the
 * provider's tool-calling layer throws or returns malformed JSON) falls back
 * to a plain-text JSON-instruction prompt with manual parsing.
 */
function describeSchema(schema: unknown): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { zodToJsonSchema } = require('zod-to-json-schema');
    const json = zodToJsonSchema(schema as any, { name: 'Target' });
    return JSON.stringify(json).slice(0, 4000);
  } catch {
    return '';
  }
}

function wrapWithJsonFallback(native: any, llm: BaseChatModel, schema: unknown) {
  const safeParse = (raw: unknown) => {
    if (schema && typeof (schema as { safeParse?: unknown }).safeParse === 'function') {
      return (schema as { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }).safeParse(raw);
    }
    return { success: true as const, data: raw };
  };
  return {
    async invoke(messages: any) {
      let nativeErr: unknown = null;
      let nativeRaw: unknown = null;
      try {
        const nativeResult = await native.invoke(messages);
        // Native runnables in @langchain/langgraph 0.2 already validate against
        // the Zod schema and return the parsed object on success. We re-validate
        // defensively, because some providers (xAI/Grok via ChatOpenAI baseURL)
        // bypass the tool-calling layer and return loosely-shaped JS objects.
        const parsed = safeParse(nativeResult);
        if (parsed.success) return parsed.data;
        nativeErr = parsed.error;
        nativeRaw = nativeResult;
      } catch (err) {
        nativeErr = err;
      }
      // Native path failed or produced invalid shape — fall back to JSON prompt.
      {
        const err = nativeErr;
        // Native path failed — try the JSON-instruction fallback.
        const schemaDescription = describeSchema(schema);
        const fallbackHint =
          'Respond with ONLY a single valid JSON object that matches the schema below. ' +
          'No prose, no markdown fences. If unsure, return the closest valid object you can.' +
          (schemaDescription ? `\n\nTarget JSON-Schema:\n${schemaDescription}` : '') +
          (nativeRaw
            ? `\n\nYour previous attempt produced this (which failed schema validation):\n${JSON.stringify(nativeRaw).slice(0, 1500)}`
            : '');
        const fallbackMessages = [...messages, { role: 'user', content: fallbackHint }];
        const result = await llm.invoke(fallbackMessages as any);
        const text = String(result.content ?? '');
        const jsonText = extractJsonBlock(text);
        try {
          const parsed = JSON.parse(jsonText);
          if (schema && typeof (schema as { safeParse?: unknown }).safeParse === 'function') {
            const validated = (schema as { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }).safeParse(parsed);
            if (validated.success) return validated.data;
            return validated.error;
          }
          return parsed;
        } catch (parseErr) {
          throw new Error(
            `Both native and JSON-fallback structured output failed. ` +
              `Native error: ${String(err)}. Parse error: ${String(parseErr)}.`,
          );
        }
      }
    },
  };
}

/**
 * Extract the first JSON object from an LLM response. Handles bare JSON,
 * fenced code blocks, and prose-then-JSON. Returns the raw string for
 * JSON.parse — does not validate.
 */
function extractJsonBlock(text: string): string {
  // 1. Prefer fenced code blocks if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1] !== undefined) return fenceMatch[1].trim();
  // 2. Bracket-depth scanner that respects strings + escapes. Finds the first
  //    balanced `{...}` block and returns it, ignoring any prose before/after.
  const start = text.indexOf('{');
  if (start < 0) return text.trim();
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // 3. Fall back to the last-`}` heuristic if scan never balanced.
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace > start) return text.slice(start, lastBrace + 1);
  return text.trim();
}
