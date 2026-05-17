/**
 * Player panel: queries Player + Counter entities.
 * Renders one card per player with their counters.
 */

import React from 'react';
import { ComponentStore } from '../engine/ecs.js';
import { EntityId } from '@bgb/shared';

interface PlayerPanelProps {
  store: ComponentStore;
  currentPlayer: EntityId | undefined;
}

/**
 * Render a panel showing all players and their counters.
 */
export const PlayerPanel: React.FC<PlayerPanelProps> = ({ store, currentPlayer }) => {
  const players = store.getEntities('Player');

  return (
    <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
      {players.map((playerId) => {
        const player = store.getComponent(playerId, 'Player');
        const counters = store.getEntities('Counter').filter((counterId) => {
          const owner = store.getComponent(counterId, 'Owner');
          return (
            owner && (owner as Record<string, unknown>).player_entity === playerId
          );
        });

        const isCurrent = playerId === currentPlayer;
        const bgColor = isCurrent ? '#e7f3ff' : '#f5f5f5';

        return (
          <div
            key={playerId}
            style={{
              border: `2px solid ${isCurrent ? '#007bff' : '#ccc'}`,
              borderRadius: '4px',
              padding: '10px',
              backgroundColor: bgColor,
              minWidth: '150px',
            }}
          >
            <h4>
              Player {(player as Record<string, unknown>)?.seat ?? '?'}
              {isCurrent && ' (Current)'}
            </h4>
            {counters.length > 0 ? (
              <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                {counters.map((counterId) => {
                  const counter = store.getComponent(counterId, 'Counter');
                  const key = (counter as Record<string, unknown>)?.key ?? 'unknown';
                  const value = (counter as Record<string, unknown>)?.value ?? 0;
                  return (
                    <li key={counterId}>
                      {key}: {value}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p style={{ margin: '5px 0', fontSize: '0.9em', color: '#999' }}>
                No counters
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
