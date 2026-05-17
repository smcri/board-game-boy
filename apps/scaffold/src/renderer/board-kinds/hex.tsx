/**
 * grid_hex board renderer: axial coordinate hex grid.
 * Each entity has BoardNode { kind: 'grid_hex', coords: { q, r } }.
 * Layout using flat-top axial → pixel: x = sqrt(3)*size*(q + r/2), y = 1.5*size*r.
 */

import React from 'react';
import { ComponentStore } from '../../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from '../visibility.js';

interface HexBoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
}

const HEX_SIZE = 30;

function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = Math.sqrt(3) * size * (q + r / 2);
  const y = (3 / 2) * size * r;
  return { x, y };
}

function getHexPoints(
  centerX: number,
  centerY: number,
  size: number,
): string {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const px = centerX + size * Math.cos(angle);
    const py = centerY + size * Math.sin(angle);
    points.push(`${px},${py}`);
  }
  return points.join(' ');
}

export const HexBoard: React.FC<HexBoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
}) => {
  const boardNodes = store.getEntities('BoardNode');
  const positions = store.getEntities('Position');

  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  const nodePixels = new Map<EntityId, { x: number; y: number }>();

  // Calculate pixel positions and bounds
  for (const nodeId of boardNodes) {
    const node = store.getComponent(nodeId, 'BoardNode');
    if (!node) continue;

    const coords = (node as Record<string, unknown>).coords as Record<string, unknown> | undefined;
    if (!coords) continue;

    const q = coords.q as number;
    const r = coords.r as number;
    const pixel = hexToPixel(q, r, HEX_SIZE);
    nodePixels.set(nodeId, pixel);

    minX = Math.min(minX, pixel.x);
    maxX = Math.max(maxX, pixel.x);
    minY = Math.min(minY, pixel.y);
    maxY = Math.max(maxY, pixel.y);
  }

  const padding = HEX_SIZE + 10;
  const width = nodePixels.size > 0 ? maxX - minX + padding * 2 : 200;
  const height = nodePixels.size > 0 ? maxY - minY + padding * 2 : 200;

  return (
    <svg
      width={Math.max(width, 200)}
      height={Math.max(height, 200)}
      style={{ border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}
      role="img"
      aria-label="hex-board"
    >
      <g transform={`translate(${padding - minX}, ${padding - minY})`}>
        {/* Render hexagons */}
        {boardNodes.map((nodeId) => {
          const pixel = nodePixels.get(nodeId);
          if (!pixel) return null;

          const points = getHexPoints(pixel.x, pixel.y, HEX_SIZE);

          return (
            <polygon
              key={nodeId}
              points={points}
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

          const pixel = nodePixels.get(nodeId);
          if (!pixel) return null;

          return (
            <circle
              key={entityId}
              cx={pixel.x}
              cy={pixel.y}
              r={8}
              fill="#007bff"
            />
          );
        })}
      </g>
    </svg>
  );
};
