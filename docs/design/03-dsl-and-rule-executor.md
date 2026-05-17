# Design Document: DSL and Rule Executor (MVP)

## Purpose & Scope

This document specifies the Domain-Specific Language (DSL) used by the Agentic Board Game Builder to represent card and action effects, and the deterministic rule executor that interprets and applies these effects to the Entity–Component–System (ECS) state.

The DSL is the interface between the rules agent (which emits structured JSON) and the game engine (which executes effects deterministically). It is a *closed set of primitive verbs* with no sandboxed code execution or effect_script interpreter in this MVP.

**In scope:**
- The six core primitive verbs and their Zod schemas
- Atomic blocks (all-or-nothing effect sequences)
- Seeded randomness (dice rolls, entity picking)
- Condition mini-language for effect guards
- Entity selectors for specifying targets
- Event log structure and replay semantics
- Error handling (Zod validation, agent retry, non-blocking fallback)

**Out of scope:**
- Tier-2 effect_script sandbox (deferred post-MVP)
- Triggered/reactive effects (post-MVP)
- Simultaneous actions or negotiation
- Optimization of engine performance (correctness first)

---

## Locked Decisions

### The Six Primitive Verbs (Minimal-6)

The DSL provides exactly six orthogonal primitive verbs. All board game effects are composed from these building blocks:

1. **`set(entity, component, field, value)`**  
   Set a component field to a specific value.  
   Example: `set(piece_id, 'Position', 'node', 'a1')` (move a chess piece)

2. **`inc(entity, component, field, delta)`**  
   Increment a numeric component field by delta (can be negative).  
   Example: `inc(player_id, 'Resources', 'gold', 5)` (add 5 gold)

3. **`move(entity, position)`**  
   Move an entity to a typed Position (see doc 02).  
   Position includes `on` (board node ID, hand ID, or 'off_board') and other typed metadata.  
   Example: `move(card_id, { on: 'hand', node: current_player_hand_id })`

4. **`choose(player_entity, options, into_meta_key)`**  
   Pause for human player input; player selects from options; result stored in `Meta.json[into_meta_key]`.  
   Example: `choose(current_player, options=adjacent_players_to(robber), into='victim_id')`

5. **`if(cond, then[], else[])`**  
   Conditional branching. `cond` is a condition expression (see Condition Mini-Language below).  
   If true, apply `then[]` effects; otherwise apply `else[]` effects.  
   Example: `if(component_present(target, 'Tile.kind'), then=[...], else=[...])`

6. **`phase(target: 'next' | 'end_turn' | { name: string })`**  
   Advance the game phase: to the next phase in sequence, end the current turn, or jump to a named phase.  
   Example: `phase('next')` (move to next phase)

### Wrappers (Higher-Order Constructs)

**`atomic([...steps])`**  
All-or-nothing effect sequence. If any step fails validation or throws, the entire atomic block rolls back to its pre-execution state (snapshot–restore).

**`random.roll({ d: number, n: number, into: meta_path })`**  
Roll an `n`-sided die `d` times; store results at `meta_path` in Meta.json.  
Seeded deterministically per build; every roll is recorded in the event log for replay.

**`random.pick({ from: query, n: number, into: meta_path })`**  
Pick `n` distinct entities matching a query selector.  
Seeded; recorded in event log.

### Condition Mini-Language

Conditions are *data*, not code. Discriminated by `op` field:

| Operator | Semantics | Example |
|----------|-----------|---------|
| `eq` | Field equals value | `{ op: 'eq', path: 'Position.node', value: 'a1' }` |
| `neq` | Field does not equal value | `{ op: 'neq', path: 'Health.hp', value: 0 }` |
| `gte`, `lte` | Numeric comparison | `{ op: 'gte', path: 'Resources.gold', value: 3 }` |
| `in` | Value in set | `{ op: 'in', path: 'Status.type', value: ['stunned', 'frozen'] }` |
| `not_in` | Value not in set | Same as above, negated |
| `and` | All subconditions true | `{ op: 'and', conditions: [...] }` |
| `or` | Any subcondition true | `{ op: 'or', conditions: [...] }` |
| `not` | Negation | `{ op: 'not', condition: {...} }` |
| `count_at_least` | Query matches ≥ n entities | `{ op: 'count_at_least', query: {...}, n: 2 }` |
| `component_present` | Entity has component | `{ op: 'component_present', entity, component: 'Tile' }` |
| `path_equals` | Compare two entity paths | `{ op: 'path_equals', path1, path2 }` |

### Entity Selectors

Selectors resolve to entity ID(s) or sets. Used in conditions and effect targets:

| Selector | Semantics |
|----------|-----------|
| `self` | The entity being inspected |
| `opponent` | The opponent of current player (2-player games) |
| `all_players` | All player entities |
| `player_choice` | The entity chosen by the player (via `choose()`) |
| `entity_id(id)` | Explicit entity ID |
| `query(componentExpr)` | ECS query: all entities matching a component expression |
| `adjacent_to(node)` | All entities on board nodes adjacent to `node` |
| `random_from(query)` | Random single entity from a query result |

### Validation & Rejection

- All verbs are Zod-validated in `packages/shared/dsl.ts`.
- Unknown verbs in agent output are rejected by Zod.
- On validation error, the agent is asked to retry **once**.
- Persistent failure (second error) becomes a non-blocking `unsupported_effect` conflict: the card/action is flagged unplayable, but the build continues.
- The bundle summary includes a report of all unsupported effects.

---

## Trade-offs Considered

### 1. Primitive Verbs vs. Specialized Domain Verbs

**Original proposal (12–14 verbs):**  
Specialized verbs like `add_resource()`, `transfer_resource()`, `place_tile()`, `draw_card()`, `discard_card()`, `advance_track()`, `score_points()`, etc. This mirrors common board game jargon.

**Expansion attempt (~20 verbs):**  
Chess-specific (`move_two_tokens_atomically`), Catan-specific (`roll_dice_and_move`), Risk-specific (`swap_positions`), etc.

**Realization:**  
Specialization creates an unbounded vocabulary. Every new game type exposes gaps in the verb set. A design that works for Catan fails on Ticket to Ride; a design that covers 5 games still fails on the 6th.

**Decision: Primitives + Composition**  
Six orthogonal primitives cover all turn-based board games:
- "Draw a card" = `move(card, {on: 'hand', node: player_hand})`
- "Add 5 resources" = `inc(player, 'Resources', 'gold', 5)`
- "Place a tile" = `set(node, 'Tile', 'kind', 'settlement')`
- "Roll a die" = `random.roll({d: 6, n: 1, into: 'roll_result'})`

**Trade-off table:**

| Aspect | Specialized | Primitives |
|--------|-------------|-----------|
| **Vocabulary size** | Open-ended (~20+) | Fixed (6) |
| **Verbosity** | Low | Medium–high |
| **LLM learnability** | High (natural) | Medium (requires idioms) |
| **Coverage** | Game-specific gaps | Universal |
| **Engine complexity** | Grows with vocabulary | Constant |
| **Composability** | Limited | Excellent (orthogonal) |

**Decision rationale:**  
- An LLM can learn a small, orthogonal set and compose idioms reliably.
- The tiny engine footprint and universal coverage justify higher verbosity.
- Idioms (e.g., "deck is an entity at a Position") are documented in examples and in-context learning.

---

### 2. Tier-1 Closed DSL vs. Tier-2 Sandboxed effect_script

The original design doc (doc 00) proposes two tiers:
- **Tier 1:** Closed DSL (what this doc specifies).
- **Tier 2:** An `effect_script` mini-language with a safe interpreter, featuring domain-friendly abstractions like `player.add_resource()`, `board.place_tile()`, etc.

**Why defer Tier-2 for the MVP:**

1. **Specification is open** (doc 00, Q1 explicitly unresolved).
   - No consensus on the Tier-2 vocabulary.
   - How do you express "add if count ≥ 3 else remove 1"? `player.add_if(count >= 3, remove_if: ...)`? Too specialized.

2. **Sandbox + interpreter = high-risk surface.**
   - Security: Even "safe" interpreters have surprises (prototype pollution, operator overloads, closure capture).
   - Correctness: Subtle bugs in effect sequencing, side-effects, rollback scope.
   - Testing: Exponentially more test cases (Python sandbox had security issues despite claims of safety).

3. **Closed DSL is sufficient.**
   - Primitives + `atomic` + `random` + conditions cover ~99% of turn-based games.
   - Edge cases (e.g., "roll 2d6 and move pawn that many spaces *only if outcome ≥ 5* else roll again") are awkward but possible with `if` + `random`.

**Risk & mitigation:**  
When the LLM tries to express an effect that feels awkward in primitives, it may emit invalid JSON. Mitigation:
- Retry once on Zod error.
- Fall back to non-blocking `unsupported_effect` conflict.
- Build is not blocked; the action is flagged for later manual review or re-prompting.

**Post-MVP path:**  
Once we have 5+ real games built, patterns will emerge. A Tier-2 spec can be designed, security-reviewed, and integrated with a minimal, proven interpreter.

---

### 3. HITL (Human-In-The-Loop) vs. Non-Blocking `unsupported_effect`

The build pipeline can surface two types of conflicts:

| Conflict Type | Root Cause | Severity | Resolution |
|---------------|-----------|----------|-----------|
| **HITL conflict** | Ambiguous rulebook; multiple defensible interpretations | `core_mechanic` | Ask human to pick best interpretation |
| **`unsupported_effect`** | Agent emitted a verb the engine cannot execute | N/A (not core) | Flag action unplayable; build continues |

**Decision:**  
- `unsupported_effect` is **non-blocking**. It does not halt the build.
- It surfaces in the bundle summary: "Card X's effect Y uses an unknown verb; flagged unplayable."
- HITL is reserved for true judgment calls (rulebook ambiguity, win condition interpretation).

**Rationale:**  
Treating both as blocking HITL would be a footgun. A user cannot "resolve" an unsupported verb by human judgment—it's a capability gap of the engine. Asking them to choose between two interpretations of something they can't execute is modal fatigue with no actionable choice.

**Alternative considered:** Per-build flag `strict_dsl_mode` (fail on unknown verbs). Rejected as too rigid; the non-blocking approach encourages gradual refinement.

---

### 4. ECS + DSL Interaction

Because the engine has **no domain knowledge**, every effect references entities and components by name:
- `set(node_entity_id, 'Tile', 'kind', 'forest')` instead of `place_forest_tile(node)`.
- `inc(player_id, 'Resources', 'gold', 5)` instead of `add_gold(player, 5)`.

This is not a bug; it's a feature. Choosing ECS in doc 02 **decouples the DSL from domain jargon**. The DSL verbs are data-agnostic; they work for chess, Catan, Ticket to Ride, and games yet to be designed.

**Trade-off:**  
- **Pro:** Universality; no predefined resources/tiles/tracks.
- **Con:** Verbosity; the agent must name entities and components.
- **Mitigation:** In-context learning examples and documentation of idioms.

---

### 5. Atomicity & Rollback Strategy

**Considered:**
1. No atomic blocks (effects always partial-commit on error).
2. Manual save/restore per step (user specifies rollback scope).
3. Full STM-like transactional engine.

**Decision: Snapshot–Restore**  
- On `atomic([...])`, snapshot the entire ECS state.
- Execute steps sequentially.
- If any step fails (Zod validation, invariant violation, exception), restore the snapshot.
- Cost: O(state size) per atomic block. Acceptable for MVP (state is small; boards are ~100–1000 entities).

**Rationale:**  
- Simple to implement and reason about.
- Deterministic (no multi-threaded surprises).
- Supports undo correctly.

---

### 6. Randomness Strategy

**Considered:**
1. Ban randomness in MVP (effects are always deterministic).
2. Allow randomness only via explicit `choose()` (human picks, no RNG).
3. First-class random with seeded determinism.

**Decision: Seeded Random + Event Log**  
- `random.roll()` and `random.pick()` generate deterministic results via a seeded PRNG.
- The seed is derived from the build ID and action execution order (e.g., first roll in action 5 uses seed `hash(build_id || 5 || 0)`).
- Every roll and pick is recorded in the event log as `{ roll: [result1, result2, ...] }` or `{ pick: [entity_id1, ...] }`.
- Replaying the exact same log of actions produces bit-identical results.

**Rationale:**  
- Determinism supports replay/undo and testing.
- Seeding ensures fairness (not biased by execution time).
- Logged results support debugging and audit.

---

## Interfaces / Data Contracts

### Effect Discriminated Union (Zod Schema Sketch)

```typescript
// packages/shared/dsl.ts

export const Effect = z.discriminatedUnion('verb', [
  z.object({
    verb: z.literal('set'),
    entity: EntitySelector,
    component: z.string(),
    field: z.string(),
    value: z.unknown(), // Validated against component schema at runtime
  }),
  z.object({
    verb: z.literal('inc'),
    entity: EntitySelector,
    component: z.string(),
    field: z.string(),
    delta: z.number(),
  }),
  z.object({
    verb: z.literal('move'),
    entity: EntitySelector,
    position: Position, // From doc 02: { on: string; node?: string; ... }
  }),
  z.object({
    verb: z.literal('choose'),
    player_entity: EntitySelector,
    options: EntitySelector, // Resolves to a set
    into: z.string(), // Meta.json key
  }),
  z.object({
    verb: z.literal('if'),
    cond: Condition,
    then: z.array(z.lazy(() => Effect)),
    else: z.array(z.lazy(() => Effect)),
  }),
  z.object({
    verb: z.literal('phase'),
    target: z.union([
      z.literal('next'),
      z.literal('end_turn'),
      z.object({ name: z.string() }),
    ]),
  }),
]);

// Wrappers
export const AtomicEffect = z.object({
  verb: z.literal('atomic'),
  steps: z.array(Effect),
});

export const RandomRoll = z.object({
  verb: z.literal('random.roll'),
  d: z.number().int().positive(),
  n: z.number().int().positive(),
  into: z.string(),
});

export const RandomPick = z.object({
  verb: z.literal('random.pick'),
  from: EntitySelector,
  n: z.number().int().positive(),
  into: z.string(),
});

export const AnyEffect = z.union([
  Effect,
  AtomicEffect,
  RandomRoll,
  RandomPick,
]);
```

### Condition Discriminated Union

```typescript
export const Condition = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('eq'),
    path: z.string(), // e.g., 'Position.node'
    value: z.unknown(),
  }),
  z.object({
    op: z.literal('neq'),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal('gte'),
    path: z.string(),
    value: z.number(),
  }),
  z.object({
    op: z.literal('lte'),
    path: z.string(),
    value: z.number(),
  }),
  z.object({
    op: z.literal('in'),
    path: z.string(),
    value: z.array(z.unknown()),
  }),
  z.object({
    op: z.literal('and'),
    conditions: z.array(z.lazy(() => Condition)),
  }),
  z.object({
    op: z.literal('or'),
    conditions: z.array(z.lazy(() => Condition)),
  }),
  z.object({
    op: z.literal('not'),
    condition: z.lazy(() => Condition),
  }),
  z.object({
    op: z.literal('count_at_least'),
    query: EntitySelector,
    n: z.number().int().nonnegative(),
  }),
  z.object({
    op: z.literal('component_present'),
    entity: EntitySelector,
    component: z.string(),
  }),
  z.object({
    op: z.literal('path_equals'),
    path1: z.string(),
    path2: z.string(),
  }),
]);
```

### Action Effect Declaration

```typescript
// In a RulesDSL action definition:
export const RulesDSLAction = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  conditions: z.array(Condition),
  effect: z.array(AnyEffect), // One or more effects
  phase_requirement: z.string().optional(),
  cost: z.unknown().optional(), // Game-specific cost
});
```

### Event Log Entry

```typescript
export const EventLogEntry = z.object({
  ts: z.number(), // Milliseconds since epoch
  action_id: z.string(),
  player_entity: z.string(), // Entity ID of the active player
  effects_applied: z.array(
    z.object({
      verb: z.string(),
      status: z.enum(['success', 'skipped', 'rolled_back']),
      error: z.string().optional(),
    })
  ),
  rolls: z.array(
    z.object({
      d: z.number(),
      n: z.number(),
      results: z.array(z.number()),
      seed: z.string(),
    })
  ).optional(),
  picks: z.array(
    z.object({
      query: z.string(),
      n: z.number(),
      result_entities: z.array(z.string()),
      seed: z.string(),
    })
  ).optional(),
  rolled_back: z.boolean().default(false),
});
```

---

## Worked Example

### Example 1: Tic-Tac-Toe Place Mark

A player clicks an empty cell to place their mark:

```json
{
  "id": "ttt_place_mark",
  "name": "Place Mark",
  "effect": [
    {
      "verb": "atomic",
      "steps": [
        {
          "verb": "set",
          "entity": { "selector": "entity_id", "id": "target_node_id" },
          "component": "Tile",
          "field": "kind",
          "value": "x"  // or "o" depending on current_player
        },
        {
          "verb": "phase",
          "target": "next"
        }
      ]
    }
  ]
}
```

### Example 2: Chess Capture (Move with Optional Remove)

A pawn moves to a square; if an opponent piece is there, capture it:

```json
{
  "id": "chess_move_with_capture",
  "name": "Move Piece",
  "effect": [
    {
      "verb": "atomic",
      "steps": [
        {
          "verb": "if",
          "cond": {
            "op": "component_present",
            "entity": { "selector": "entity_id", "id": "target_node_id" },
            "component": "Tile"
          },
          "then": [
            {
              "verb": "move",
              "entity": {
                "selector": "query",
                "componentExpr": { "Tile": { "opponent_piece": true } }
              },
              "position": { "on": "off_board" }
            }
          ],
          "else": []
        },
        {
          "verb": "move",
          "entity": { "selector": "entity_id", "id": "piece_entity_id" },
          "position": { "on": "board", "node": "target_square" }
        },
        {
          "verb": "phase",
          "target": "next"
        }
      ]
    }
  ]
}
```

### Example 3: Catan Rob (Robber Placement + Steal)

A player places the robber on a node and steals a random resource card from an adjacent player:

```json
{
  "id": "catan_rob",
  "name": "Rob with Robber",
  "effect": [
    {
      "verb": "choose",
      "player_entity": { "selector": "self" },
      "options": {
        "selector": "adjacent_to",
        "node": "current_robber_position"
      },
      "into": "victim_id"
    },
    {
      "verb": "set",
      "entity": { "selector": "entity_id", "id": "robber_entity_id" },
      "component": "Position",
      "field": "node",
      "value": "target_node"
    },
    {
      "verb": "random.pick",
      "from": {
        "selector": "query",
        "componentExpr": {
          "Owner": { "entity_id": { "selector": "player_choice" } },
          "Hand": {}
        }
      },
      "n": 1,
      "into": "stolen_card_id"
    },
    {
      "verb": "move",
      "entity": { "selector": "player_choice", "key": "stolen_card_id" },
      "position": { "on": "hand", "node": "current_player_hand_id" }
    }
  ]
}
```

---

## Open Questions & Follow-ups

1. **Tier-2 effect_script Sandbox**  
   When and how should a safer, domain-friendly scripting layer be added? What vocabulary? What security model? This is a post-MVP decision that will be informed by real games built with Minimal-6.

2. **Additional Verbs (Resist the Temptation)**  
   Should we add `swap()`, `copy_component()`, `remove_component()`, or `create_entity()`? Likely no for MVP. These can be expressed (awkwardly) via primitives or are rare enough to defer.

3. **Triggered & Reactive Effects**  
   "When X happens elsewhere, execute Y." This requires a pub/sub or event system layered on top of the effect executor. Deferred post-MVP (high complexity; low immediate ROI).

4. **Simultaneous Actions & Negotiation**  
   Multi-player turns, simultaneous moves, trade negotiation. Out of scope; likely require a protocol layer above effects.

5. **DSL Versioning**  
   The `bundle.json` should embed a `dsl_version` field so the engine can refuse to load bundles built against an incompatible DSL version. Future safety measure.

6. **Performance of Large Atomics**  
   If an atomic block with 1000+ steps fails late, restoring a large snapshot is slow. For MVP, acceptable. Post-MVP, consider incremental undo logs or copy-on-write.

7. **Condition Completeness**  
   Are there common board game conditions not yet covered? (E.g., "entity has component A but not B"?) Likely covered by `and` + `not` + `component_present`, but gather feedback.

---

## References

- **Doc 02 (ECS & State Model):**  
  Defines the Entity, Component, and System architecture; the Position type; and the state schema.
  
- **Doc 04 (Rules Agent):**  
  Describes how the LLM rules agent emits this DSL as structured JSON using `withStructuredOutput()`.
  
- **Doc 06 (Engine Execution):**  
  Details the rule executor loop that interprets and applies DSL effects deterministically.
  
- **Code:**
  - `packages/shared/dsl.ts`: Zod schemas for all verbs, conditions, and selectors.
  - `apps/scaffold/engine/rule-executor.ts`: The deterministic switch statement over verbs.
  - `apps/scaffold/engine/event-log.ts`: Append-only event log and replay logic.

---

**Document Version:** 1.0 (MVP)  
**Last Updated:** 2026-05-17  
**Status:** Locked (pending implementation feedback)
