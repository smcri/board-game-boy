// RulesDSL — the structured output of the rules agent. See doc 04.

import { z } from 'zod';
import { EntityDecl } from './ecs.js';
import { EffectSchema, ConditionSchema, type Condition as ConditionT } from './dsl.js';

export const ActionParam = z.object({
  name: z.string().min(1),
  kind: z.enum(['entity', 'number', 'string', 'enum', 'position']),
  options: z.array(z.unknown()).optional(),
});

export const ActionDecl = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  params: z.array(ActionParam).optional(),
  preconditions: z.array(ConditionSchema).optional(),
  effect: z.array(EffectSchema).min(1),
});
export type ActionDecl = z.infer<typeof ActionDecl>;

export const WinConditionSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  /** Any player satisfying `when` wins. */
  when: ConditionSchema,
  /** Optional explicit selector for "winner" if multiple players could satisfy. */
  resolves_to: z.enum(['current_player', 'most_points', 'last_remaining']).optional(),
});
export type WinCondition = z.infer<typeof WinConditionSchema>;
/** Back-compat alias (used at both value and type positions). */
export const WinCondition = WinConditionSchema;

// ── Conflicts ────────────────────────────────────────────────────────────────

export const SourceRef = z.object({
  url: z.string(),
  title: z.string().optional(),
  source_type: z.enum(['pdf', 'publisher', 'bgg', 'fan', 'user_paste']),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const ConflictSeverity = z.enum([
  'core_mechanic',
  'rule_detail',
  'flavor',
  'unsupported_effect',
]);

export const Conflict = z.object({
  id: z.string().min(1),
  rule: z.string().min(1),
  description: z.string().min(1),
  sources: z.array(SourceRef).min(1),
  severity: ConflictSeverity,
  confidence: z.number().min(0).max(1),
  /** Optional pre-filled suggested resolution when severity != unsupported_effect. */
  suggested_resolution: z.string().optional(),
  /** Filled in after HITL for core_mechanic conflicts. */
  resolution: z
    .object({
      decision: z.enum(['accept', 'override']),
      value: z.unknown().optional(),
      note: z.string().optional(),
    })
    .optional(),
});
export type Conflict = z.infer<typeof Conflict>;

// ── RulesDSL ─────────────────────────────────────────────────────────────────

export const RulesDsl = z.object({
  /** Embedded for runtime compatibility checks. */
  dsl_version: z.literal('1.0'),
  metadata: z.object({
    game_name: z.string().min(1),
    summary: z.string().optional(),
    min_players: z.number().int().positive(),
    max_players: z.number().int().positive(),
  }),
  /** Initial set of entities + their components. */
  entities: z.array(EntityDecl).min(1),
  /** Actions players can dispatch. */
  actions: z.array(ActionDecl).min(1),
  /** Win conditions checked by the win-condition system after each effect. */
  win_conditions: z.array(WinConditionSchema).min(1),
  /** Conflicts collected during the rules agent run. */
  conflicts: z.array(Conflict).default([]),
});
export type RulesDsl = z.infer<typeof RulesDsl>;
