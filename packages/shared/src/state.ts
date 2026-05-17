// LangGraph BuildState — the in-flight state for one build. See doc 05.

import { z } from 'zod';
import { LlmProvider, SearchProvider, BuildMode } from './providers.js';
import { RulesDsl, Conflict } from './rules.js';
import { AssetManifest } from './assets.js';

export const BuildStatus = z.enum([
  'classifying',
  'fetching',
  'parsing',
  'awaiting_review',
  'building_assets',
  'assembling',
  'done',
  'error',
]);
export type BuildStatus = z.infer<typeof BuildStatus>;

export const UserDecision = z.record(
  z.string(), // conflict_id
  z.union([
    z.literal('accept'),
    z.literal('override'),
    z.object({ value: z.unknown(), note: z.string().optional() }),
  ]),
);
export type UserDecision = z.infer<typeof UserDecision>;

export const BuildState = z.object({
  bundle_id: z.string().min(1),
  prompt: z.string().min(1),
  mode: BuildMode,
  custom_rules: z.string().optional(),

  // Provider config (chosen in UI; per-request only)
  llm_provider: LlmProvider,
  llm_model: z.string().min(1),
  llm_api_key: z.string().optional(),
  search_provider: SearchProvider.optional(),
  search_api_key: z.string().optional(),

  // Outputs (filled by the graph as it progresses)
  status: BuildStatus.default('classifying'),
  rules_dsl: RulesDsl.optional(),
  conflicts: z.array(Conflict).default([]),
  asset_manifest: AssetManifest.optional(),
  user_decision: UserDecision.optional(),
  errors: z.array(z.string()).default([]),
});
export type BuildState = z.infer<typeof BuildState>;
