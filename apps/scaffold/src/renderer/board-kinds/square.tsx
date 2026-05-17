/**
 * grid_square board renderer.
 * Each entity has BoardNode { kind: 'grid_square', coords: { file, rank } }.
 */

import React from 'react';
import { ComponentStore } from '../../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from '../visibility.js';

interface SquareBoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
}

const SQUARE_SIZE = 40;

export const SquareBoard: React.FC<SquareBoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
}) => {
  const boardNodes = store.getEntities('BoardNode');
  const positions = store.getEntities('Position');

  return (
    <svg
      width={400}
      height={400}
      style={{ border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}
      role="img"
      aria-label="square-board"
    >
      <g>
        {boardNodes.map((nodeId) => {
          const node = store.getComponent(nodeId, 'BoardNode');
          const pos = node ? (node as Record<string, unknown>).coords : undefined;

          if (!pos) return null;

          const file = (pos as Record<string, unknown>).file as number;
          const rank = (pos as Record<string, unknown>).rank as number;
          const x = file * SQUARE_SIZE + 10;
          const y = rank * SQUARE_SIZE + 10;

          return (
            <rect
              key={nodeId}
              x={x}
              y={y}
              width={SQUARE_SIZE}
              height={SQUARE_SIZE}
              fill="white"
              stroke="#ccc"
              strokeWidth={1}
            />
          );
        })}

        {/* Render positioned entities */}
        {positions.map((entityId) => {
          if (!currentPlayer || !isVisibleToCurrentPlayer(store, entityId, currentPlayer)) {
            return null;
          }

          const position = store.getComponent(entityId, 'Position');
          if (!position || (position as Record<string, unknown>).on !== 'board') {
            return null;
          }

          const nodeId = (position as Record<string, unknown>).node as EntityId | undefined;
          if (!nodeId) return null;

          const node = store.getComponent(nodeId, 'BoardNode');
          const pos = node ? (node as Record<string, unknown>).coords : undefined;

          if (!pos) return null;

          const file = (pos as Record<string, unknown>).file as number;
          const rank = (pos as Record<string, unknown>).rank as number;
          const x = file * SQUARE_SIZE + 10;
          const y = rank * SQUARE_SIZE + 10;

          return (
            <circle
              key={entityId}
              cx={x + SQUARE_SIZE / 2}
              cy={y + SQUARE_SIZE / 2}
              r={8}
              fill="#007bff"
            />
          );
        })}
      </g>
    </svg>
  );
};
