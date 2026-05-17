/**
 * Board renderer: queries BoardNode + Position entities.
 * Renders grid/hex/graph based on BoardConfig.kind.
 */

import React from 'react';
import { ComponentStore } from '../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from './visibility.js';

interface BoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
}

/**
 * Render the board based on kind and board nodes.
 */
export const Board: React.FC<BoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
  assetManifest,
}) => {
  const boardNodes = store.getEntities('BoardNode');
  const positions = store.getEntities('Position');

  if (boardConfig.kind === 'grid_square') {
    return (
      <svg
        width={400}
        height={400}
        style={{ border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}
      >
        <g>
          {boardNodes.map((nodeId) => {
            const node = store.getComponent(nodeId, 'BoardNode');
            const pos = node ? (node as Record<string, unknown>).coords : undefined;

            if (!pos) return null;

            const file = (pos as Record<string, unknown>).file as number;
            const rank = (pos as Record<string, unknown>).rank as number;
            const squareSize = 40;
            const x = file * squareSize + 10;
            const y = rank * squareSize + 10;

            return (
              <rect
                key={nodeId}
                x={x}
                y={y}
                width={squareSize}
                height={squareSize}
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
            const squareSize = 40;
            const x = file * squareSize + 10;
            const y = rank * squareSize + 10;

            const identity = store.getComponent(entityId, 'Identity');
            const label = identity
              ? (identity as Record<string, unknown>).name
              : entityId.slice(0, 4);

            return (
              <circle
                key={entityId}
                cx={x + squareSize / 2}
                cy={y + squareSize / 2}
                r={8}
                fill="#007bff"
              />
            );
          })}
        </g>
      </svg>
    );
  }

  // For other board kinds, render a simple fallback
  return (
    <div style={{ padding: '10px', border: '1px solid #ccc' }}>
      <p>Board kind: {boardConfig.kind}</p>
      <p>Nodes: {boardNodes.length}</p>
    </div>
  );
};
