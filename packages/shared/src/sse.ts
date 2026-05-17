// SSE event union types emitted by GET /builds/:id/stream. See doc 05.

import { z } from 'zod';
import { Conflict } from './rules.js';
import { BuildStatus } from './state.js';

export const SseUpdate = z.object({
  type: z.literal('update'),
  status: BuildStatus,
  node: z.string(),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const SseSearch = z.object({
  type: z.literal('search'),
  provider: z.string(),
  query: z.string(),
  hits: z.number().int().nonnegative(),
});

export const SseFetch = z.object({
  type: z.literal('fetch'),
  url: z.string(),
  status: z.enum(['started', 'done', 'cache_hit', 'error']),
  bytes: z.number().int().nonnegative().optional(),
  source_type: z.string().optional(),
});

export const SseInterrupt = z.object({
  type: z.literal('interrupt'),
  reason: z.literal('core_mechanic_conflicts'),
  conflicts: z.array(Conflict).min(1),
});

export const SseDone = z.object({
  type: z.literal('done'),
  bundle_id: z.string(),
  bundle_url: z.string(),
  conflicts_summary: z.object({
    blocking: z.number().int().nonnegative(),
    non_blocking: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
  }),
});

export const SseError = z.object({
  type: z.literal('error'),
  node: z.string().optional(),
  message: z.string(),
});

export const SseEvent = z.discriminatedUnion('type', [
  SseUpdate,
  SseSearch,
  SseFetch,
  SseInterrupt,
  SseDone,
  SseError,
]);
export type SseEvent = z.infer<typeof SseEvent>;
