/**
 * Test suite for condition evaluator: all operators.
 */

import { describe, it, expect } from 'vitest';
import { ComponentStore } from '../engine/ecs.js';
import { evaluateCondition } from '../engine/conditions.js';
import { EntityDecl } from '@bgb/shared';

describe('evaluateCondition', () => {
  let store: ComponentStore;
  const currentPlayer = 'player1' as const;

  beforeEach(() => {
    store = new ComponentStore();
    const decl: EntityDecl = {
      id: 'player1',
      components: {
        Counter: { key: 'health', value: 10, min: 0, max: 20 },
        Player: { seat: 0 },
      },
    };
    store.addEntity(decl);
  });

  describe('comparison operators', () => {
    it('should evaluate eq', () => {
      const cond = {
        op: 'eq',
        path: 'player1.Counter.value',
        value: 10,
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should evaluate neq', () => {
      const cond = {
        op: 'neq',
        path: 'player1.Counter.value',
        value: 5,
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should evaluate gte', () => {
      const cond = {
        op: 'gte',
        path: 'player1.Counter.value',
        value: 10,
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should evaluate lte', () => {
      const cond = {
        op: 'lte',
        path: 'player1.Counter.value',
        value: 10,
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should evaluate in', () => {
      const cond = {
        op: 'in',
        path: 'player1.Counter.value',
        values: [5, 10, 15],
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should evaluate not_in', () => {
      const cond = {
        op: 'not_in',
        path: 'player1.Counter.value',
        values: [5, 15, 20],
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('should evaluate and', () => {
      const cond = {
        op: 'and',
        conds: [
          {
            op: 'eq',
            path: 'player1.Counter.value',
            value: 10,
          },
          {
            op: 'eq',
            path: 'player1.Player.seat',
            value: 0,
          },
        ],
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should evaluate or', () => {
      const cond = {
        op: 'or',
        conds: [
          {
            op: 'eq',
            path: 'player1.Counter.value',
            value: 99,
          },
          {
            op: 'eq',
            path: 'player1.Player.seat',
            value: 0,
          },
        ],
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should evaluate not', () => {
      const cond = {
        op: 'not',
        cond: {
          op: 'eq',
          path: 'player1.Counter.value',
          value: 99,
        },
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });
  });

  describe('count_at_least', () => {
    it('should count entities matching selector', () => {
      const cond = {
        op: 'count_at_least',
        selector: { kind: 'all_players' },
        n: 1,
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });
  });

  describe('component_present', () => {
    it('should check if entity has component', () => {
      const cond = {
        op: 'component_present',
        entity: 'player1',
        component: 'Counter',
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(true);
    });

    it('should return false if entity lacks component', () => {
      const cond = {
        op: 'component_present',
        entity: 'player1',
        component: 'Card',
      };
      expect(evaluateCondition(store, cond, currentPlayer)).toBe(false);
    });
  });
});
