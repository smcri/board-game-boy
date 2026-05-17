// Bundle manifest — the contract between Phase 1 and Phase 2. See doc 06.

import { z } from 'zod';
import { RulesDsl, Conflict } from './rules.js';
import { AssetManifest } from './assets.js';

export const BundleMetadata = z.object({
  game_name: z.string().min(1),
  built_at: z.string(), // ISO 8601
  llm_provider: z.string(),
  llm_model: z.string(),
  search_provider: z.string().optional(),
  mode: z.string(),
});

export const Bundle = z.object({
  bundle_id: z.string().min(1),
  version: z.literal('0.1.0'),
  dsl_version: z.literal('1.0'),
  rules_dsl: RulesDsl,
  asset_manifest: AssetManifest,
  conflicts_resolved: z.array(Conflict).default([]),
  conflicts_unresolved_non_blocking: z.array(Conflict).default([]),
  // Build-time warnings (non-fatal errors collected during the run). Empty
  // on a clean build. Surfaced in the runtime UI so players see what didn't
  // work even when the build itself completed.
  build_warnings: z.array(z.string()).default([]).optional(),
  metadata: BundleMetadata,
});
export type Bundle = z.infer<typeof Bundle>;

export const BoardConfig = z.object({
  kind: z.enum(['graph', 'grid_hex', 'grid_square', 'track', 'region_map']),
  nodes: z.array(
    z.object({
      id: z.string(),
      coords: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
      neighbours: z.array(z.string()).optional(),
    }),
  ),
  regions: z.array(z.object({ id: z.string(), nodes: z.array(z.string()) })).optional(),
  render_hints: z.record(z.string(), z.unknown()).optional(),
});
export type BoardConfig = z.infer<typeof BoardConfig>;
