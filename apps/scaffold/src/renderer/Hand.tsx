/**
 * Hand renderer: queries Card + Owner + Position(on:hand) entities.
 * Respects Visibility: owner-only cards shown only when state.current_player matches owner.
 */

import React from 'react';
import { ComponentStore } from '../engine/ecs.js';
import { EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from './visibility.js';

interface HandProps {
  store: ComponentStore;
  currentPlayer: EntityId | undefined;
}

/**
 * Render cards in the current player's hand.
 */
export const Hand: React.FC<HandProps> = ({ store, currentPlayer }) => {
  if (!currentPlayer) {
    return <div>No current player</div>;
  }

  const cards = store.getEntities('Card').filter((cardId) => {
    // Card must be in hand position
    const position = store.getComponent(cardId, 'Position');
    if (!position || (position as Record<string, unknown>).on !== 'hand') {
      return false;
    }

    // Card must be visible to current player
    return isVisibleToCurrentPlayer(store, cardId, currentPlayer);
  });

  return (
    <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f5f5f5' }}>
      <h3>Hand</h3>
      {cards.length === 0 ? (
        <p style={{ color: '#999' }}>No cards in hand</p>
      ) : (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {cards.map((cardId) => {
            const card = store.getComponent(cardId, 'Card');
            const template = (card as Record<string, unknown>)?.template ?? 'unknown';

            return (
              <div
                key={cardId}
                style={{
                  border: '1px solid #333',
                  borderRadius: '4px',
                  padding: '8px',
                  backgroundColor: '#fff',
                  minWidth: '80px',
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
                title={cardId}
              >
                <div style={{ fontSize: '0.9em', fontWeight: 'bold' }}>{String(template)}</div>
                <div style={{ fontSize: '0.8em', color: '#666' }}>
                  {cardId.slice(0, 4)}...
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
