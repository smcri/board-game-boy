/**
 * Visibility helper: determine if an entity is visible to the current player.
 * Render-time only; no crypto involved.
 */

import { ComponentStore } from '../engine/ecs.js';
import { EntityId, VisibilityScope } from '@bgb/shared';

/**
 * Check if an entity is visible to the current player.
 * @param store - The ECS store
 * @param entityId - The entity to check
 * @param currentPlayer - The current player entity ID
 * @returns true if visible
 */
export function isVisibleToCurrentPlayer(
  store: ComponentStore,
  entityId: EntityId,
  currentPlayer: EntityId,
): boolean {
  // Check Visibility component
  const visibility = store.getComponent(entityId, 'Visibility');
  if (visibility) {
    const scope = (visibility as Record<string, unknown>).scope as VisibilityScope;
    if (scope === 'public') return true;
    if (scope === 'none') return false;
    if (scope === 'owner') {
      const owner = store.getComponent(entityId, 'Owner');
      if (owner) {
        return (owner as Record<string, unknown>).player_entity === currentPlayer;
      }
      return false;
    }
  }

  // Check Hand/Deck visibility
  const hand = store.getComponent(entityId, 'Hand');
  if (hand) {
    const scope = (hand as Record<string, unknown>).visibility as VisibilityScope;
    if (scope === 'public') return true;
    if (scope === 'none') return false;
    if (scope === 'owner') {
      // Check Position.on === hand and owner
      const position = store.getComponent(entityId, 'Position');
      if (position && (position as Record<string, unknown>).on === 'hand') {
        const owner = store.getComponent(entityId, 'Owner');
        if (owner) {
          return (owner as Record<string, unknown>).player_entity === currentPlayer;
        }
      }
      return false;
    }
  }

  const deck = store.getComponent(entityId, 'Deck');
  if (deck) {
    const scope = (deck as Record<string, unknown>).visibility as VisibilityScope;
    if (scope === 'public') return true;
    if (scope === 'none') return false;
    if (scope === 'owner') {
      const owner = store.getComponent(entityId, 'Owner');
      if (owner) {
        return (owner as Record<string, unknown>).player_entity === currentPlayer;
      }
      return false;
    }
  }

  // Default: visible
  return true;
}
