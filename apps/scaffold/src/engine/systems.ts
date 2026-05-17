/**
 * Game systems: turn loop, phase advancement, win condition checking.
 * Called after every action is dispatched.
 */

import { ComponentStore } from './ecs.js';
import { evaluateCondition } from './conditions.js';
import { EntityId, RulesDsl, WinCondition } from '@bgb/shared';

export interface GameState {
  winner?: EntityId;
  gameOver: boolean;
}

/**
 * Advance to the next player in turn order.
 */
export function advanceTurn(store: ComponentStore): void {
  const players = store.getEntities('Player');
  if (players.length === 0) return;

  const turn = store.getComponent('_turn_singleton' as EntityId, 'Turn');
  if (!turn) return;

  const currentIdx = players.indexOf((turn as Record<string, unknown>).current_player as EntityId);
  const nextIdx = (currentIdx + 1) % players.length;
  (turn as Record<string, unknown>).current_player = players[nextIdx];
}

/**
 * Get the current player.
 */
export function getCurrentPlayer(store: ComponentStore): EntityId | undefined {
  const turn = store.getComponent('_turn_singleton' as EntityId, 'Turn');
  if (turn) {
    return (turn as Record<string, unknown>).current_player as EntityId;
  }
  const players = store.getEntities('Player');
  return players[0];
}

/**
 * Check all win conditions and return winner if any are met.
 */
export function checkWinConditions(
  store: ComponentStore,
  winConditions: WinCondition[],
  currentPlayer: EntityId,
): EntityId | undefined {
  for (const wc of winConditions) {
    const satisfied = evaluateCondition(store, wc.when, currentPlayer);
    if (satisfied) {
      // For MVP, just return current player; resolves_to logic deferred
      return currentPlayer;
    }
  }
  return undefined;
}

/**
 * Run all systems after an action is dispatched.
 */
export function runSystems(
  store: ComponentStore,
  rulesDsl: RulesDsl,
): GameState {
  const currentPlayer = getCurrentPlayer(store);
  if (!currentPlayer) {
    return { gameOver: false };
  }

  const winner = checkWinConditions(store, rulesDsl.win_conditions, currentPlayer);
  if (winner) {
    return { winner, gameOver: true };
  }

  return { gameOver: false };
}
