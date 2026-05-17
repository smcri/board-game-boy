// Closed primitive DSL. See docs/design/03-dsl-and-rule-executor.md.
// 6 primitive verbs + atomic + random. All Zod-validated; the executor is a
// deterministic switch.

import { z } from 'zod';
import { ComponentName, EntityId, C_Position } from './ecs.js';

// ── Selectors ────────────────────────────────────────────────────────────────

const ComponentExpr: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ has: ComponentName }),
    z.object({ where: z.object({ component: ComponentName, op: ConditionOp, value: z.unknown() }) }),
    z.object({ and: z.array(ComponentExpr).min(1) }),
    z.object({ or: z.array(ComponentExpr).min(1) }),
    z.object({ not: ComponentExpr }),
  ]),
);

export const Selector: z.ZodType<unknown> = z.lazy(() =>
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

export const Condition: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('eq'), path: Path, value: z.unknown() }),
    z.object({ op: z.literal('neq'), path: Path, value: z.unknown() }),
    z.object({ op: z.literal('gte'), path: Path, value: z.number() }),
    z.object({ op: z.literal('lte'), path: Path, value: z.number() }),
    z.object({ op: z.literal('in'), path: Path, values: z.array(z.unknown()) }),
    z.object({ op: z.literal('not_in'), path: Path, values: z.array(z.unknown()) }),
    z.object({ op: z.literal('and'), conds: z.array(Condition).min(1) }),
    z.object({ op: z.literal('or'), conds: z.array(Condition).min(1) }),
    z.object({ op: z.literal('not'), cond: Condition }),
    z.object({ op: z.literal('count_at_least'), selector: Selector, n: z.number().int().nonnegative() }),
    z.object({ op: z.literal('component_present'), entity: z.union([EntityId, Selector]), component: ComponentName }),
    z.object({ op: z.literal('path_equals'), path: Path, value: z.unknown() }),
  ]),
);

// ── Verbs ────────────────────────────────────────────────────────────────────

const EntityRef = z.union([EntityId, Selector]);
const PlayerRef = z.union([EntityId, Selector]);
const ComponentField = z.string().min(1);

export const PhaseTarget = z.union([
  z.literal('next'),
  z.literal('end_turn'),
  z.object({ name: z.string().min(1) }),
]);

export const Effect: z.ZodType<unknown> = z.lazy(() =>
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
      cond: Condition,
      then: z.array(Effect),
      else: z.array(Effect).optional(),
    }),
    z.object({
      verb: z.literal('phase'),
      target: PhaseTarget,
    }),
    // Wrappers
    z.object({
      verb: z.literal('atomic'),
      steps: z.array(Effect).min(1),
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

// ── Event log entry ─────────────────────────────────────────────────────────

export const EventLogEntry = z.object({
  ts: z.number(), // ms since epoch
  action_id: z.string(),
  player_entity: EntityId.optional(),
  effects_applied: z.array(Effect),
  rolls: z.array(z.object({ d: z.number(), values: z.array(z.number()) })).optional(),
  picks: z.array(z.object({ from_count: z.number(), picked: z.array(EntityId) })).optional(),
  rolled_back: z.boolean().optional(),
});
export type EventLogEntry = z.infer<typeof EventLogEntry>;
