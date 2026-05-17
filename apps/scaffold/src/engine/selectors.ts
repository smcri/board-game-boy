/**
 * Resolve selectors to entity IDs.
 * Handles: self, opponent, all_players, player_choice, entity, query, adjacent_to, random_from.
 */

import { ComponentStore } from './ecs.js';
import { EntityId } from '@bgb/shared';

export type Selector = unknown;

/**
 * Resolve a selector to a list of entity IDs.
 * @param store - The ECS store
 * @param currentPlayer - Current player entity ID
 * @param selector - The selector object
 * @returns Array of matching entity IDs
 */
export function resolveSelector(
  store: ComponentStore,
  currentPlayer: EntityId,
  selector: Selector,
): EntityId[] {
  const sel = selector as Record<string, unknown>;
  const kind = sel.kind as string;

  if (kind === 'self') {
    return [currentPlayer];
  }

  if (kind === 'opponent') {
    // Get all players and return those != current player
    const players = store.getEntities('Player');
    return players.filter((p) => p !== currentPlayer);
  }

  if (kind === 'all_players') {
    return store.getEntities('Player');
  }

  if (kind === 'player_choice') {
    // This is a placeholder; actual resolution happens at runtime via UI.
    return [];
  }

  if (kind === 'entity') {
    return [sel.id as EntityId];
  }

  if (kind === 'query') {
    return store.query(sel.expr as unknown);
  }

  if (kind === 'adjacent_to') {
    const nodeId = sel.node as EntityId;
    const adj = store.getComponent(nodeId, 'Adjacency');
    if (adj && 'to' in adj) {
      return adj.to as EntityId[];
    }
    return [];
  }

  if (kind === 'random_from') {
    // This is evaluated at effect execution time with the RNG.
    // For now, return all matches; the executor will select n of them.
    return store.query(sel.query as unknown);
  }

  return [];
}
