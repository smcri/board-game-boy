/**
 * track board renderer: linear or circular track.
 * BoardNode { kind: 'track' } entities lay out either in a row (default)
 * or on a circle if BoardConfig.render_hints.shape === 'circle'.
 */

import React from 'react';
import { ComponentStore } from '../../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from '../visibility.js';

interface TrackBoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
}

const NODE_RADIUS = 6;
const NODE_SPACING = 40;

export const TrackBoard: React.FC<TrackBoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
}) => {
  const positions = store.getEntities('Position');
  const nodePositions = new Map<string, { x: number; y: number }>();

  const isCircular = (boardConfig.render_hints as Record<string, unknown> | undefined)?.shape === 'circle';
  const nodeCount = boardConfig.nodes.length;

  if (isCircular && nodeCount > 0) {
    // Circular layout
    const radius = Math.max(80, nodeCount * 8);
    const centerX = radius + 40;
    const centerY = radius + 40;

    for (let i = 0; i < nodeCount; i++) {
      const angle = (2 * Math.PI * i) / nodeCount;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      const node = boardConfig.nodes[i];
      if (node) {
        nodePositions.set(node.id, { x, y });
      }
    }
  } else {
    // Linear layout (row)
    for (let i = 0; i < nodeCount; i++) {
      const x = 20 + i * NODE_SPACING;
      const y = 50;
      const node = boardConfig.nodes[i];
      if (node) {
        nodePositions.set(node.id, { x, y });
      }
    }
  }

  const width = isCircular
    ? Math.max(2 * (Math.max(80, nodeCount * 8) + 40), 200)
    : Math.max(20 + nodeCount * NODE_SPACING, 200);
  const height = isCircular ? width : 120;

  return (
    <svg
      width={width}
      height={height}
      style={{ border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}
      role="img"
      aria-label="track-board"
    >
      <g>
        {/* Render track nodes */}
        {boardConfig.nodes.map((node) => {
          const pos = nodePositions.get(node.id);
          if (!pos) return null;

          return (
            <circle
              key={node.id}
              cx={pos.x}
              cy={pos.y}
              r={NODE_RADIUS}
              fill="white"
              stroke="#ccc"
              strokeWidth={1}
            />
          );
        })}

        {/* Render positioned entities (stacked above nodes) */}
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

          const pos = nodePositions.get(nodeId);
          if (!pos) return null;

          const slot = (position as Record<string, unknown>).slot as number | undefined;
          const offsetY = slot ? -(slot + 1) * 8 : -8;

          return (
            <circle
              key={entityId}
              cx={pos.x}
              cy={pos.y + offsetY}
              r={5}
              fill="#007bff"
            />
          );
        })}
      </g>
    </svg>
  );
};
