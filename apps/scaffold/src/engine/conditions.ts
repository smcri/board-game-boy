/**
 * Condition evaluator for the closed DSL.
 * Handles all operators: eq, neq, gte, lte, in, not_in, and, or, not,
 * count_at_least, component_present, path_equals.
 */

import { ComponentStore } from './ecs.js';
import { resolveSelector } from './selectors.js';
import { EntityId } from '@bgb/shared';

export type Condition = unknown;

/**
 * Evaluate a condition against the current store state.
 * @param store - The ECS store
 * @param cond - The condition object
 * @param currentPlayer - Current player entity ID
 * @returns true if condition is satisfied
 */
export function evaluateCondition(
  store: ComponentStore,
  cond: Condition,
  currentPlayer: EntityId,
): boolean {
  const c = cond as Record<string, unknown>;

  if (c.op === 'eq') {
    const value = getPathValue(store, c.path as string, currentPlayer);
    return value === c.value;
  }

  if (c.op === 'neq') {
    const value = getPathValue(store, c.path as string, currentPlayer);
    return value !== c.value;
  }

  if (c.op === 'gte') {
    const value = getPathValue(store, c.path as string, currentPlayer) as number;
    return value >= (c.value as number);
  }

  if (c.op === 'lte') {
    const value = getPathValue(store, c.path as string, currentPlayer) as number;
    return value <= (c.value as number);
  }

  if (c.op === 'in') {
    const value = getPathValue(store, c.path as string, currentPlayer);
    return (c.values as unknown[]).includes(value);
  }

  if (c.op === 'not_in') {
    const value = getPathValue(store, c.path as string, currentPlayer);
    return !(c.values as unknown[]).includes(value);
  }

  if (c.op === 'and') {
    return (c.conds as Condition[]).every((cond) =>
      evaluateCondition(store, cond, currentPlayer),
    );
  }

  if (c.op === 'or') {
    return (c.conds as Condition[]).some((cond) =>
      evaluateCondition(store, cond, currentPlayer),
    );
  }

  if (c.op === 'not') {
    return !evaluateCondition(store, c.cond as Condition, currentPlayer);
  }

  if (c.op === 'count_at_least') {
    const selector = c.selector as unknown;
    const entities = resolveSelector(store, currentPlayer, selector);
    return entities.length >= (c.n as number);
  }

  if (c.op === 'component_present') {
    const entity = c.entity as unknown;
    const entities = Array.isArray(entity)
      ? entity
      : typeof entity === 'string'
        ? [entity as EntityId]
        : resolveSelector(store, currentPlayer, entity);
    const component = c.component as string;
    return entities.some((eid) => store.getComponent(eid, component as any) !== undefined);
  }

  if (c.op === 'path_equals') {
    const value = getPathValue(store, c.path as string, currentPlayer);
    return value === c.value;
  }

  return false;
}

/**
 * Resolve a dot-path string against the store, e.g. "player_entity.Counter.heat"
 */
function getPathValue(store: ComponentStore, path: string, currentPlayer: EntityId): unknown {
  const parts = path.split('.');
  if (parts.length === 0) return undefined;

  // First part: entity selector
  let entity: EntityId | undefined;
  const firstPart = parts[0];

  if (firstPart === 'current_player') {
    entity = currentPlayer;
  } else {
    entity = firstPart as EntityId;
  }

  if (!entity) return undefined;
  if (parts.length === 1) return entity;

  // Remaining parts: component.field navigation
  let current: unknown = entity;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) return undefined;
    if (typeof current === 'string') {
      // current is an entity ID, fetch component
      const comp = store.getComponent(current as EntityId, part as any);
      current = comp;
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
