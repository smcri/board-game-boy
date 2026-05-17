import { describe, it, expect } from 'vitest';
import {
  EntityDecl,
  Effect,
  RulesDsl,
  Bundle,
  BuildState,
  SseEvent,
  COMPONENT_REGISTRY,
} from '../index.js';

describe('ECS', () => {
  it('accepts a valid entity with known components', () => {
    const decl = {
      id: 'p1',
      components: { Player: { seat: 0, current: true }, Identity: { name: 'Alice', kind: 'player' } },
    };
    expect(EntityDecl.safeParse(decl).success).toBe(true);
  });

  it('rejects an unknown component', () => {
    const r = EntityDecl.safeParse({ id: 'x', components: { Bogus: {} } });
    expect(r.success).toBe(false);
  });

  it('rejects invalid component data', () => {
    const r = EntityDecl.safeParse({ id: 'x', components: { Player: { seat: 'first' } } });
    expect(r.success).toBe(false);
  });

  it('contains all the documented component kinds', () => {
    const expected = [
      'Identity', 'Player', 'Owner', 'Counter', 'Position', 'Adjacency',
      'BoardNode', 'Card', 'Deck', 'Hand', 'Tile', 'Token', 'Phase', 'Turn',
      'Visibility', 'Meta',
    ];
    for (const k of expected) expect(COMPONENT_REGISTRY).toHaveProperty(k);
  });
});

describe('DSL', () => {
  it('parses a Minimal-6 verb', () => {
    const e = { verb: 'inc', entity: 'p1', component: 'Counter', field: 'value', delta: 1 };
    expect(Effect.safeParse(e).success).toBe(true);
  });

  it('parses atomic + random wrappers', () => {
    const e = {
      verb: 'atomic',
      steps: [
        { verb: 'random.roll', d: 6, n: 2, into: 'roll' },
        { verb: 'phase', target: 'next' },
      ],
    };
    expect(Effect.safeParse(e).success).toBe(true);
  });

  it('rejects an unknown verb', () => {
    expect(Effect.safeParse({ verb: 'teleport' }).success).toBe(false);
  });
});

describe('RulesDsl + Bundle', () => {
  const baseRules = {
    dsl_version: '1.0',
    metadata: { game_name: 'TicTacToe', min_players: 2, max_players: 2 },
    entities: [{ id: 'p1', components: { Player: { seat: 0 } } }],
    actions: [
      {
        id: 'mark',
        name: 'Place mark',
        effect: [{ verb: 'phase', target: 'next' }],
      },
    ],
    win_conditions: [
      { id: 'three_in_a_row', description: 'three in a row', when: { op: 'eq', path: 'meta.win', value: true } },
    ],
    conflicts: [],
  };

  it('accepts a minimal RulesDsl', () => {
    expect(RulesDsl.safeParse(baseRules).success).toBe(true);
  });

  it('accepts a Bundle wrapper', () => {
    const b = {
      bundle_id: 'bld_1',
      version: '0.1.0',
      dsl_version: '1.0',
      rules_dsl: baseRules,
      asset_manifest: { palette: [], entries: [] },
      metadata: {
        game_name: 'TicTacToe',
        built_at: new Date().toISOString(),
        llm_provider: 'ollama',
        llm_model: 'llama3.1:8b',
        mode: 'known_game',
      },
    };
    expect(Bundle.safeParse(b).success).toBe(true);
  });
});

describe('BuildState + SSE', () => {
  it('parses a minimum BuildState', () => {
    const s = BuildState.safeParse({
      bundle_id: 'bld_1',
      prompt: 'Chess',
      mode: 'known_game',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
    });
    expect(s.success).toBe(true);
  });

  it('parses an SSE update event', () => {
    const r = SseEvent.safeParse({ type: 'update', status: 'fetching', node: 'rules_agent' });
    expect(r.success).toBe(true);
  });
});
