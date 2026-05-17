/**
 * rules-example.ts
 *
 * A compiler-checked RulesDsl value used as the prompt example in the rules
 * agent. Because it is typed as `RulesDsl`, any schema change that breaks this
 * example will fail `pnpm typecheck` *before* it can reach production.
 *
 * The game (Snakes & Ladders) is chosen because it covers:
 *   - track topology (BoardNode kind "track")
 *   - token movement (verb "move", then verb "set" for snap)
 *   - dice (verb "random.roll")
 *   - conditional effects (verb "if" + condition "gte")
 *   - turn progression (verb "phase" target "end_turn")
 *   - a win condition using a component-field comparison
 *   - a core_mechanic conflict (exact-landing rule ambiguity)
 *
 * It is intentionally NOT a simple example — it demonstrates every DSL
 * construct the rules agent is allowed to emit.
 */

import type { RulesDsl } from '@bgb/shared';

export const EXAMPLE_RULES_DSL: RulesDsl = {
  dsl_version: '1.0',
  metadata: {
    game_name: 'Snakes and Ladders',
    summary:
      'Players roll one 6-sided die and advance a token along a 100-square track. ' +
      'Landing on the bottom of a ladder teleports the token to the ladder top. ' +
      'Landing on a snake head teleports the token to the snake tail. ' +
      'First player whose token reaches or passes square 100 wins.',
    min_players: 2,
    max_players: 4,
  },
  entities: [
    // ── CRITICAL PATTERN: Generate explicit board node entities ──────────────
    // For a track game, create square_0 through square_N as individual entities.
    // For a grid game (grid_square), create sq_C_R entities (col, row).
    // Each node entity MUST have: BoardNode (with kind + index/coords) + Identity.
    // Token Position.node MUST reference the node entity id (e.g. 'square_0').
    // ─────────────────────────────────────────────────────────────────────────
    { id: 'square_0',   components: { Identity: { name: 'Square 0',   kind: 'board_node' }, BoardNode: { kind: 'track', index: 0   } } },
    { id: 'square_1',   components: { Identity: { name: 'Square 1',   kind: 'board_node' }, BoardNode: { kind: 'track', index: 1   } } },
    { id: 'square_2',   components: { Identity: { name: 'Square 2',   kind: 'board_node' }, BoardNode: { kind: 'track', index: 2   } } },
    // ... generate square_3 through square_99 following the same pattern ...
    { id: 'square_100', components: { Identity: { name: 'Square 100', kind: 'board_node' }, BoardNode: { kind: 'track', index: 100 } } },
    {
      id: 'turn_tracker',
      components: {
        Identity: { name: 'Turn tracker', kind: 'system' },
        Turn: { current_player: 'player1' },
      },
    },
    {
      id: 'player1',
      components: {
        Identity: { name: 'Player 1', kind: 'player' },
        Player: { seat: 1 },
      },
    },
    {
      id: 'player2',
      components: {
        Identity: { name: 'Player 2', kind: 'player' },
        Player: { seat: 2 },
      },
    },
    {
      id: 'token_p1',
      components: {
        Identity: { name: 'Player 1 token', kind: 'token' },
        Token: { kind: 'pawn' },
        Counter: { key: 'square', value: 0, min: 0, max: 100 },
        Owner: { player_entity: 'player1' },
        Position: { on: 'board', node: 'square_0' },
      },
    },
    {
      id: 'token_p2',
      components: {
        Identity: { name: 'Player 2 token', kind: 'token' },
        Token: { kind: 'pawn' },
        Counter: { key: 'square', value: 0, min: 0, max: 100 },
        Owner: { player_entity: 'player2' },
        Position: { on: 'board', node: 'square_0' },
      },
    },
  ],
  actions: [
    {
      id: 'roll_and_move',
      name: 'Roll die and advance token',
      description:
        'Current player rolls one d6, advances their token by the result, then ' +
        'applies any snake or ladder at the destination.',
      preconditions: [
        {
          op: 'component_present',
          entity: { kind: 'self' },
          component: 'Player',
        },
      ],
      effect: [
        // 1. Roll 1d6, store result in token Meta
        {
          verb: 'random.roll',
          d: 6,
          n: 1,
          into: 'roll_result',
        },
        // 2. Advance token Counter.square by the roll
        {
          verb: 'inc',
          entity: { kind: 'query', expr: { where: { component: 'Owner', op: 'eq', value: 'player1' } } },
          component: 'Counter',
          field: 'value',
          delta: 1, // The executor substitutes the actual roll at runtime
        },
        // 3. Move Position node to match the new square
        {
          verb: 'move',
          entity: { kind: 'query', expr: { where: { component: 'Owner', op: 'eq', value: 'player1' } } },
          to: { on: 'board' },
        },
        // 4. Apply ladder: square 4 → 14
        {
          verb: 'if',
          cond: { op: 'eq', path: 'token_p1.Counter.value', value: 4 },
          then: [
            {
              verb: 'set',
              entity: 'token_p1',
              component: 'Counter',
              field: 'value',
              value: 14,
            },
          ],
        },
        // 5. Apply snake: square 17 → 7
        {
          verb: 'if',
          cond: { op: 'eq', path: 'token_p1.Counter.value', value: 17 },
          then: [
            {
              verb: 'set',
              entity: 'token_p1',
              component: 'Counter',
              field: 'value',
              value: 7,
            },
          ],
        },
        // 6. End turn
        { verb: 'phase', target: 'end_turn' },
      ],
    },
  ],
  win_conditions: [
    {
      id: 'reach_100',
      description: 'First player whose token reaches or passes square 100 wins.',
      when: {
        op: 'gte',
        path: 'token_p1.Counter.value',
        value: 100,
      },
      resolves_to: 'current_player',
    },
  ],
  conflicts: [
    {
      id: 'exact_landing_rule',
      rule: 'Exact-landing requirement for square 100',
      description:
        'Some editions require a player to land on square 100 by exact die roll; ' +
        'overshooting bounces the token back. Other editions let any roll that ' +
        'reaches or exceeds 100 end the game immediately.',
      sources: [
        {
          url: 'https://en.wikipedia.org/wiki/Snakes_and_Ladders',
          title: 'Snakes and Ladders — Wikipedia',
          source_type: 'fan',
        },
      ],
      severity: 'core_mechanic',
      confidence: 0.75,
      suggested_resolution:
        'Default to "reach or exceed 100 wins" unless the user specifies otherwise.',
    },
  ],
};

/** Serialised form injected into the rules-agent prompt. */
export const EXAMPLE_RULES_DSL_JSON: string = JSON.stringify(EXAMPLE_RULES_DSL, null, 2);
