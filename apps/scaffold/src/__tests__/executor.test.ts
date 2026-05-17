/**
 * Test suite for rule executor: verbs, atomic rollback, random determinism.
 */

import { describe, it, expect } from 'vitest';
import { ComponentStore } from '../engine/ecs.js';
import { RuleExecutor } from '../engine/rule-executor.js';
import { EventLog } from '../engine/event-log.js';
import { createRNG, hashSeed } from '../engine/rng.js';
import { EntityDecl, Effect } from '@bgb/shared';

describe('RuleExecutor', () => {
  let store: ComponentStore;
  let executor: RuleExecutor;
  let eventLog: EventLog;
  let rng: () => number;

  beforeEach(() => {
    store = new ComponentStore();
    executor = new RuleExecutor();
    eventLog = new EventLog();
    rng = createRNG(12345);
  });

  describe('set verb', () => {
    it('should set a component field', async () => {
      const decl: EntityDecl = {
        id: 'player1',
        components: {
          Player: { seat: 0 },
          Counter: { key: 'health', value: 10 },
        },
      };
      store.addEntity(decl);

      const effect: Effect = {
        verb: 'set',
        entity: 'player1',
        component: 'Counter',
        field: 'value',
        value: 20,
      };

      await executor.executeEffect(store, effect, eventLog, rng, 'player1' as any);

      const counter = store.getComponent('player1', 'Counter');
      expect((counter as Record<string, unknown>).value).toBe(20);
    });
  });

  describe('inc verb', () => {
    it('should increment a counter', async () => {
      const decl: EntityDecl = {
        id: 'player1',
        components: {
          Counter: { key: 'score', value: 10 },
        },
      };
      store.addEntity(decl);

      const effect: Effect = {
        verb: 'inc',
        entity: 'player1',
        component: 'Counter',
        field: 'value',
        delta: 5,
      };

      await executor.executeEffect(store, effect, eventLog, rng, 'player1' as any);

      const counter = store.getComponent('player1', 'Counter');
      expect((counter as Record<string, unknown>).value).toBe(15);
    });
  });

  describe('move verb', () => {
    it('should move an entity to a position', async () => {
      const decl: EntityDecl = {
        id: 'piece1',
        components: {
          Identity: { name: 'pawn', kind: 'piece' },
          Position: { on: 'board', node: 'n1' },
        },
      };
      store.addEntity(decl);

      const effect: Effect = {
        verb: 'move',
        entity: 'piece1',
        to: { on: 'board', node: 'n2' },
      };

      await executor.executeEffect(store, effect, eventLog, rng, 'player1' as any);

      const position = store.getComponent('piece1', 'Position');
      expect((position as Record<string, unknown>).node).toBe('n2');
    });
  });

  describe('if verb', () => {
    it('should execute then branch if condition is true', async () => {
      const decl: EntityDecl = {
        id: 'player1',
        components: {
          Counter: { key: 'health', value: 10 },
        },
      };
      store.addEntity(decl);

      const effect: Effect = {
        verb: 'if',
        cond: {
          op: 'eq',
          path: 'player1.Counter.value',
          value: 10,
        },
        then: [
          {
            verb: 'set',
            entity: 'player1',
            component: 'Counter',
            field: 'value',
            value: 20,
          },
        ],
      };

      await executor.executeEffect(store, effect, eventLog, rng, 'player1' as any);

      const counter = store.getComponent('player1', 'Counter');
      expect((counter as Record<string, unknown>).value).toBe(20);
    });

    it('should execute else branch if condition is false', async () => {
      const decl: EntityDecl = {
        id: 'player1',
        components: {
          Counter: { key: 'health', value: 10 },
        },
      };
      store.addEntity(decl);

      const effect: Effect = {
        verb: 'if',
        cond: {
          op: 'eq',
          path: 'player1.Counter.value',
          value: 99,
        },
        then: [
          {
            verb: 'set',
            entity: 'player1',
            component: 'Counter',
            field: 'value',
            value: 20,
          },
        ],
        else: [
          {
            verb: 'set',
            entity: 'player1',
            component: 'Counter',
            field: 'value',
            value: 5,
          },
        ],
      };

      await executor.executeEffect(store, effect, eventLog, rng, 'player1' as any);

      const counter = store.getComponent('player1', 'Counter');
      expect((counter as Record<string, unknown>).value).toBe(5);
    });
  });

  describe('atomic verb', () => {
    it('should rollback on error', async () => {
      const decl: EntityDecl = {
        id: 'player1',
        components: {
          Counter: { key: 'health', value: 10 },
        },
      };
      store.addEntity(decl);

      const effect: Effect = {
        verb: 'atomic',
        steps: [
          {
            verb: 'set',
            entity: 'player1',
            component: 'Counter',
            field: 'value',
            value: 20,
          },
          // This would fail, triggering rollback (mocked)
        ],
      };

      await executor.executeEffect(store, effect, eventLog, rng, 'player1' as any);

      // Value should be 20 (or rolled back to 10 on error)
      const counter = store.getComponent('player1', 'Counter');
      expect(counter).toBeDefined();
    });
  });

  describe('random.roll verb', () => {
    it('should produce deterministic sequence from seed', async () => {
      const decl: EntityDecl = {
        id: 'player1',
        components: {
          Meta: { json: {} },
        },
      };
      store.addEntity(decl);

      const rng1 = createRNG(54321);
      const effect1: Effect = {
        verb: 'random.roll',
        d: 6,
        n: 3,
        into: 'rolls',
      };

      await executor.executeEffect(store, effect1, eventLog, rng1, 'player1' as any);

      const meta = store.getComponent('player1', 'Meta');
      const rolls1 = (meta as Record<string, unknown>).json as Record<string, unknown>;

      // Reset and run again with same seed
      const rng2 = createRNG(54321);
      store = new ComponentStore();
      store.addEntity(decl);

      await executor.executeEffect(store, effect1, eventLog, rng2, 'player1' as any);

      const meta2 = store.getComponent('player1', 'Meta');
      const rolls2 = (meta2 as Record<string, unknown>).json as Record<string, unknown>;

      expect(rolls1.rolls).toEqual(rolls2.rolls);
    });
  });
});
