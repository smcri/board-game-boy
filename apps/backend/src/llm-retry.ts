/**
 * Shared LLM retry helper for agents.
 *
 * Three-strategy approach:
 *   1. Plain: send the prompt as-is.
 *   2. Fix-the-errors: feed the Zod errors + bad JSON back in, ask LLM to fix.
 *   3. Lenient: instruct LLM to fill in defaults / prefer valid JSON over precision.
 *
 * Returns the parsed value, the number of attempts used, and the final error
 * (only set when all attempts fail).
 */
import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { withStructuredOutput } from './llm.js';
import { logger } from './logger.js';

export type LlmRetryResult<T> = {
  value: T | null;
  attempts: number;
  error: string | null;
};

export interface LlmRetryOpts<T extends z.ZodTypeAny> {
  llm: BaseChatModel;
  schema: T;
  schemaName: string;
  systemPrompt: string;
  userPrompt: string;
  /** Optional override of max attempts; defaults to 3. */
  maxAttempts?: number;
  /** Optional tag used in logs to identify the caller. */
  tag?: string;
}

/**
 * Run a 3-strategy structured-output call. Returns parsed value or null if all
 * strategies failed. Never throws — caller decides how to handle failure.
 */
export async function llmJsonRetry<T extends z.ZodTypeAny>(
  opts: LlmRetryOpts<T>,
): Promise<LlmRetryResult<z.infer<T>>> {
  const { llm, schema, schemaName, systemPrompt, userPrompt, tag = schemaName } = opts;
  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? 3, 5));

  let value: z.infer<T> | null = null as z.infer<T> | null;
  let error: string | null = null;
  let lastBadRaw: unknown = null;
  let attempts = 0;

  const tryOnce = async (extraSystem: string, extraHuman: string): Promise<void> => {
    attempts += 1;
    const structuredLlm = withStructuredOutput(llm, schema, { name: schemaName });
    const sys = extraSystem ? `${systemPrompt}\n\n${extraSystem}` : systemPrompt;
    const human = extraHuman ? `${userPrompt}\n\n${extraHuman}` : userPrompt;
    const result = await structuredLlm.invoke([new SystemMessage(sys), new HumanMessage(human)]);
    if (result instanceof z.ZodError) {
      error = result.message;
      lastBadRaw = (result as unknown as { _raw?: unknown })._raw ?? null;
    } else {
      value = result;
      error = null;
    }
  };

  // Attempt 1 — plain
  try {
    await tryOnce('', '');
  } catch (err) {
    error = String(err);
    lastBadRaw = (err as { rawOutput?: unknown }).rawOutput ?? null;
    logger.warn({ tag, error }, 'llmJsonRetry attempt 1 failed');
  }

  // Attempt 2 — fix the errors
  if (!value && attempts < maxAttempts) {
    try {
      const fixHint =
        `Your previous JSON had validation errors. Fix ONLY the listed fields; keep everything else identical. Return the same shape.\n\n` +
        `ERRORS:\n${error ?? 'unknown'}` +
        (lastBadRaw ? `\n\nBAD JSON:\n${JSON.stringify(lastBadRaw).slice(0, 2000)}` : '');
      await tryOnce('', fixHint);
    } catch (err) {
      error = String(err);
      logger.warn({ tag, error }, 'llmJsonRetry attempt 2 (fix-errors) failed');
    }
  }

  // Attempt 3 — lenient
  if (!value && attempts < maxAttempts) {
    try {
      await tryOnce(
        'Be lenient with the schema; fill in defaults where needed. Prefer valid JSON over precision.',
        '',
      );
    } catch (err) {
      error = String(err);
      logger.warn({ tag, error }, 'llmJsonRetry attempt 3 (lenient) failed');
    }
  }

  return { value, attempts, error };
}
