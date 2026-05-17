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

  const isTransient = (err: unknown): boolean => {
    const msg = String((err as { message?: unknown } | null)?.message ?? err ?? '').toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('timeout')
    );
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Hard timeout for a single LLM invoke — 45 seconds. */
  const LLM_TIMEOUT_MS = 45_000;

  const invokeWithTimeout = async (
    structuredLlm: ReturnType<typeof withStructuredOutput>,
    messages: [SystemMessage, HumanMessage],
  ) => {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM call timed out after ${LLM_TIMEOUT_MS / 1000}s`)), LLM_TIMEOUT_MS),
    );
    return Promise.race([structuredLlm.invoke(messages), timeoutPromise]);
  };

  const tryOnce = async (extraSystem: string, extraHuman: string): Promise<void> => {
    attempts += 1;
    const structuredLlm = withStructuredOutput(llm, schema, { name: schemaName });
    const sys = extraSystem ? `${systemPrompt}\n\n${extraSystem}` : systemPrompt;
    const human = extraHuman ? `${userPrompt}\n\n${extraHuman}` : userPrompt;

    // Backoff on transient errors: 500ms, 1500ms, 4500ms with jitter.
    // Does NOT consume a strategy slot — only retries the same attempt.
    const backoffs = [500, 1500, 4500];
    let lastTransientErr: unknown = null;
    for (let i = 0; i <= backoffs.length; i++) {
      try {
        const result = await invokeWithTimeout(structuredLlm, [
          new SystemMessage(sys),
          new HumanMessage(human),
        ]);
        if (result instanceof z.ZodError) {
          error = result.message;
          lastBadRaw = (result as unknown as { _raw?: unknown })._raw ?? null;
        } else {
          value = result;
          error = null;
        }
        return;
      } catch (err) {
        if (!isTransient(err) || i === backoffs.length) {
          throw err;
        }
        lastTransientErr = err;
        const jitter = Math.floor(Math.random() * 250);
        logger.warn(
          { tag, err: String(err).slice(0, 200), backoff_ms: (backoffs[i] ?? 0) + jitter },
          'llmJsonRetry transient error; backing off',
        );
        await sleep(backoffs[i]! + jitter);
      }
    }
    throw lastTransientErr;
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

  // Attempt 3 — strict schema correction (no leniency; full schema attached)
  // We never soften the schema requirements. Instead we give the LLM one more
  // chance with the full target schema so it can self-correct precisely.
  if (!value && attempts < maxAttempts) {
    try {
      const schemaHint =
        `Your last response still did not match the required schema.\n` +
        `Here are the remaining validation errors:\n${error ?? 'unknown'}\n\n` +
        `Fix EVERY listed error. Produce ONLY a valid JSON object. No markdown, no commentary.`;
      await tryOnce(schemaHint, '');
    } catch (err) {
      error = String(err);
      logger.warn({ tag, error }, 'llmJsonRetry attempt 3 (schema-correction) failed');
    }
  }

  return { value, attempts, error };
}
