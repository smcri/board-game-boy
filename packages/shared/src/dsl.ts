// Closed primitive DSL. See docs/design/03-dsl-and-rule-executor.md.
// 6 primitive verbs + atomic + random. All Zod-validated; the executor is a
// deterministic switch.

import { z } from 'zod';
import { ComponentName, EntityId, C_Position } from './ecs.js';

// ── Selectors ────────────────────────────────────────────────────────────────

/**
 * Recursive types are awkward in Zod; we declare the TS shape explicitly so
 * downstream packages can `import type { Effect, Condition, Selector,
 * ComponentExpr } from '@bgb/shared'` without losing precision.
 */
export type ComponentExpr =
  | { has: string }
  | { where: { component: string; op: ConditionOpKind; value?: unknown } }
  | { and: ComponentExpr[] }
  | { or: ComponentExpr[] }
  | { not: ComponentExpr };

export type Selector =
  | { kind: 'self' }
  | { kind: 'opponent' }
  | { kind: 'all_players' }
  | { kind: 'player_choice' }
  | { kind: 'entity'; id: string }
  | { kind: 'query'; expr: ComponentExpr }
  | { kind: 'adjacent_to'; node: string }
  | { kind: 'random_from'; query: ComponentExpr; n: number };

export type ConditionOpKind =
  | 'eq' | 'neq' | 'gte' | 'lte' | 'in' | 'not_in'
  | 'and' | 'or' | 'not'
  | 'count_at_least' | 'component_present' | 'path_equals';

export type Condition =
  | { op: 'eq' | 'neq' | 'path_equals'; path: string; value?: unknown }
  | { op: 'gte' | 'lte'; path: string; value: number }
  | { op: 'in' | 'not_in'; path: string; values: unknown[] }
  | { op: 'and' | 'or'; conds: Condition[] }
  | { op: 'not'; cond: Condition }
  | { op: 'count_at_least'; selector: Selector; n: number }
  | { op: 'component_present'; entity: string | Selector; component: string };

export type PhaseTarget = 'next' | 'end_turn' | { name: string };

export type Effect =
  | { verb: 'set'; entity: string | Selector; component: string; field: string; value?: unknown }
  | { verb: 'inc'; entity: string | Selector; component: string; field: string; delta: number }
  | { verb: 'move'; entity: string | Selector; to: { on: 'board' | 'deck' | 'hand' | 'region' | 'off_board'; node?: string; slot?: number } }
  | { verb: 'choose'; player: string | Selector; options: unknown[]; into: string }
  | { verb: 'if'; cond: Condition; then: Effect[]; else?: Effect[] }
  | { verb: 'phase'; target: PhaseTarget }
  | { verb: 'atomic'; steps: Effect[] }
  | { verb: 'random.roll'; d: number; n: number; into: string }
  | { verb: 'random.pick'; from: ComponentExpr; n: number; into: string };

const ComponentExpr: z.ZodType<ComponentExpr> = z.lazy(() =>
  z.union([
    z.object({ has: ComponentName }),
    z.object({ where: z.object({ component: ComponentName, op: ConditionOp, value: z.unknown() }) }),
    z.object({ and: z.array(ComponentExpr).min(1) }),
    z.object({ or: z.array(ComponentExpr).min(1) }),
    z.object({ not: ComponentExpr }),
  ]),
);

export const SelectorSchema: z.ZodType<Selector> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('self') }),
    z.object({ kind: z.literal('opponent') }),
    z.object({ kind: z.literal('all_players') }),
    z.object({ kind: z.literal('player_choice') }),
    z.object({ kind: z.literal('entity'), id: EntityId }),
    z.object({ kind: z.literal('query'), expr: ComponentExpr }),
    z.object({ kind: z.literal('adjacent_to'), node: EntityId }),
    z.object({ kind: z.literal('random_from'), query: ComponentExpr, n: z.number().int().positive() }),
  ]),
);

// ── Conditions ──────────────────────────────────────────────────────────────

export const ConditionOp = z.enum([
  'eq', 'neq', 'gte', 'lte', 'in', 'not_in',
  'and', 'or', 'not',
  'count_at_least', 'component_present', 'path_equals',
]);

const Path = z.string().min(1); // dot.path against state, e.g. "current_player.Counter.heat"

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('eq'), path: Path, value: z.unknown() }),
    z.object({ op: z.literal('neq'), path: Path, value: z.unknown() }),
    z.object({ op: z.literal('gte'), path: Path, value: z.number() }),
    z.object({ op: z.literal('lte'), path: Path, value: z.number() }),
    z.object({ op: z.literal('in'), path: Path, values: z.array(z.unknown()) }),
    z.object({ op: z.literal('not_in'), path: Path, values: z.array(z.unknown()) }),
    z.object({ op: z.literal('and'), conds: z.array(ConditionSchema).min(1) }),
    z.object({ op: z.literal('or'), conds: z.array(ConditionSchema).min(1) }),
    z.object({ op: z.literal('not'), cond: ConditionSchema }),
    z.object({ op: z.literal('count_at_least'), selector: SelectorSchema, n: z.number().int().nonnegative() }),
    z.object({ op: z.literal('component_present'), entity: z.union([EntityId, SelectorSchema]), component: ComponentName }),
    z.object({ op: z.literal('path_equals'), path: Path, value: z.unknown() }),
  ]),
);

// ── Verbs ────────────────────────────────────────────────────────────────────

const EntityRef = z.union([EntityId, SelectorSchema]);
const PlayerRef = z.union([EntityId, SelectorSchema]);
const ComponentField = z.string().min(1);

export const PhaseTargetSchema = z.union([
  z.literal('next'),
  z.literal('end_turn'),
  z.object({ name: z.string().min(1) }),
]);

export const EffectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.discriminatedUnion('verb', [
    z.object({
      verb: z.literal('set'),
      entity: EntityRef,
      component: ComponentName,
      field: ComponentField,
      value: z.unknown(),
    }),
    z.object({
      verb: z.literal('inc'),
      entity: EntityRef,
      component: ComponentName,
      field: ComponentField,
      delta: z.number(),
    }),
    z.object({
      verb: z.literal('move'),
      entity: EntityRef,
      to: C_Position,
    }),
    z.object({
      verb: z.literal('choose'),
      player: PlayerRef,
      options: z.array(z.unknown()).min(1),
      into: z.string().min(1), // key under Meta.json
    }),
    z.object({
      verb: z.literal('if'),
      cond: ConditionSchema,
      then: z.array(EffectSchema),
      else: z.array(EffectSchema).optional(),
    }),
    z.object({
      verb: z.literal('phase'),
      target: PhaseTargetSchema,
    }),
    // Wrappers
    z.object({
      verb: z.literal('atomic'),
      steps: z.array(EffectSchema).min(1),
    }),
    z.object({
      verb: z.literal('random.roll'),
      d: z.number().int().positive(), // d-sided
      n: z.number().int().positive(),
      into: z.string().min(1),
    }),
    z.object({
      verb: z.literal('random.pick'),
      from: ComponentExpr,
      n: z.number().int().positive(),
      into: z.string().min(1),
    }),
  ]),
);

/**
 * Back-compat aliases so older code can still `import { Effect, Condition,
 * Selector } from '@bgb/shared'` and get *both* the runtime schema and the TS
 * type (the type wins at type-position, the value wins at value-position).
 */
export const Effect = EffectSchema;
export const Condition = ConditionSchema;
export const Selector = SelectorSchema;
export const PhaseTarget = PhaseTargetSchema;

// ── Event log entry ─────────────────────────────────────────────────────────

export const EventLogEntry = z.object({
  ts: z.number(), // ms since epoch
  action_id: z.string(),
  player_entity: EntityId.optional(),
  effects_applied: z.array(EffectSchema),
  rolls: z.array(z.object({ d: z.number(), values: z.array(z.number()) })).optional(),
  picks: z.array(z.object({ from_count: z.number(), picked: z.array(EntityId) })).optional(),
  rolled_back: z.boolean().optional(),
});
export type EventLogEntry = z.infer<typeof EventLogEntry>;
