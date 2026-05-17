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

const SQUARE_SIZE = 48;
const PADDING = 4;

export const SquareBoard: React.FC<SquareBoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
}) => {
  const boardNodes = store.getEntities('BoardNode');
  const positions = store.getEntities('Position');

  // Compute grid dimensions from nodes
  let maxFile = 0; let maxRank = 0;
  for (const nodeId of boardNodes) {
    const node = store.getComponent(nodeId, 'BoardNode') as Record<string, unknown> | undefined;
    const coords = node?.coords as Record<string, number> | undefined;
    if (coords) {
      maxFile = Math.max(maxFile, (coords.file ?? 0));
      maxRank = Math.max(maxRank, (coords.rank ?? 0));
    }
  }
  const cols = maxFile + 1;
  const rows = maxRank + 1;
  const svgW = cols * SQUARE_SIZE + PADDING * 2;
  const svgH = rows * SQUARE_SIZE + PADDING * 2;

  // Build map: nodeId → pixel center
  const nodeCoords = new Map<string, { cx: number; cy: number }>();
  for (const nodeId of boardNodes) {
    const node = store.getComponent(nodeId, 'BoardNode') as Record<string, unknown> | undefined;
    const coords = node?.coords as Record<string, number> | undefined;
    if (coords) {
      const file = coords.file ?? 0;
      const rank = coords.rank ?? 0;
      nodeCoords.set(nodeId, {
        cx: PADDING + file * SQUARE_SIZE + SQUARE_SIZE / 2,
        cy: PADDING + rank * SQUARE_SIZE + SQUARE_SIZE / 2,
      });
    }
  }

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{ border: '1px solid #888', display: 'block' }}
      role="img"
      aria-label="square-board"
    >
      {/* Board squares with checkerboard pattern */}
      {boardNodes.map((nodeId) => {
        const node = store.getComponent(nodeId, 'BoardNode') as Record<string, unknown> | undefined;
        const coords = node?.coords as Record<string, number> | undefined;
        if (!coords) return null;
        const file = coords.file ?? 0;
        const rank = coords.rank ?? 0;
        const x = PADDING + file * SQUARE_SIZE;
        const y = PADDING + rank * SQUARE_SIZE;
        const isLight = (file + rank) % 2 === 0;
        return (
          <rect
            key={nodeId}
            x={x} y={y}
            width={SQUARE_SIZE} height={SQUARE_SIZE}
            fill={isLight ? '#f0d9b5' : '#b58863'}
            stroke="#555" strokeWidth={0.5}
          />
        );
      })}

      {/* Tokens / pieces */}
      {positions.map((entityId) => {
        const position = store.getComponent(entityId, 'Position') as Record<string, unknown> | undefined;
        if (!position || position['on'] !== 'board') return null;
        const nodeId = position['node'] as string | undefined;
        if (!nodeId) return null;
        const center = nodeCoords.get(nodeId);
        if (!center) return null;

        const token = store.getComponent(entityId, 'Token') as Record<string, unknown> | undefined;
        const identity = store.getComponent(entityId, 'Identity') as Record<string, unknown> | undefined;
        const owner = store.getComponent(entityId, 'Owner') as Record<string, unknown> | undefined;
        const label = (token?.kind as string) ?? (identity?.name as string) ?? entityId;
        const isVisible = !currentPlayer || isVisibleToCurrentPlayer(store, entityId, currentPlayer);
        if (!isVisible) return null;

        // Color by owner
        const ownerPlayer = owner?.player_entity as string | undefined;
        const isCurrentOwner = ownerPlayer === currentPlayer;
        const fill = isCurrentOwner ? '#2563eb' : '#dc2626';

        return (
          <g key={entityId}>
            <circle cx={center.cx} cy={center.cy} r={SQUARE_SIZE / 2 - 4} fill={fill} stroke="white" strokeWidth={2} />
            <text
              x={center.cx} y={center.cy + 4}
              textAnchor="middle"
              fontSize={10}
              fill="white"
              fontWeight="bold"
              style={{ userSelect: 'none', pointerEvents: 'none' }}
            >
              {label.slice(0, 3).toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
