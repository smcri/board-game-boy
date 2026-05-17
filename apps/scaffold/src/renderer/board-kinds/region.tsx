/**
 * region_map board renderer: unstyled region polygons (e.g. Risk).
 * BoardConfig.regions[].nodes lists which nodes form a region.
 * If region polygon coords absent, render as flat-coloured blocks in a strip with labels.
 * If coords present (render_hints.region_paths[id]: 'M x y L ...'), render as <path />.
 */

import React from 'react';
import { ComponentStore } from '../../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from '../visibility.js';

interface RegionMapBoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
}

const REGION_WIDTH = 80;
const REGION_HEIGHT = 60;
const COLORS = [
  '#ff6b6b',
  '#4ecdc4',
  '#45b7d1',
  '#f9ca24',
  '#6c5ce7',
  '#a29bfe',
  '#fd79a8',
  '#fdcb6e',
];

export const RegionMapBoard: React.FC<RegionMapBoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
}) => {
  const positions = store.getEntities('Position');
  const regions = boardConfig.regions ?? [];
  const renderHints = (boardConfig.render_hints ?? {}) as Record<string, unknown>;
  const regionPaths = (renderHints.region_paths as Record<string, string>) || {};

  const regionPositions = new Map<string, { x: number; y: number }>();

  // Calculate region positions
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (!region) continue;
    const x = 10 + i * (REGION_WIDTH + 10);
    const y = 10;
    regionPositions.set(region.id, { x, y });
  }

  const width = Math.max(10 + regions.length * (REGION_WIDTH + 10), 200);
  const hasRegionPaths = Object.keys(regionPaths).length > 0;
  const height = hasRegionPaths ? 400 : REGION_HEIGHT + 40;

  return (
    <svg
      width={width}
      height={height}
      style={{ border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}
      role="img"
      aria-label="region-map-board"
    >
      <g>
        {regions.map((region, idx) => {
          const color = COLORS[idx % COLORS.length];
          const pos = regionPositions.get(region.id);
          if (!pos) return null;

          if (regionPaths[region.id]) {
            // Render as path
            return (
              <path
                key={region.id}
                d={String(regionPaths[region.id])}
                fill={color}
                stroke="#333"
                strokeWidth={1}
                opacity={0.7}
              />
            );
          }

          // Render as flat-coloured block with label
          return (
            <g key={region.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={REGION_WIDTH}
                height={REGION_HEIGHT}
                fill={color}
                stroke="#333"
                strokeWidth={1}
                opacity={0.7}
              />
              <text
                x={pos.x + REGION_WIDTH / 2}
                y={pos.y + REGION_HEIGHT / 2 + 5}
                textAnchor="middle"
                fontSize={12}
                fill="white"
                fontWeight="bold"
              >
                {region.id}
              </text>
            </g>
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

          // Find region containing this node
          let regionId: string | undefined;
          for (const region of regions) {
            if (region.nodes.includes(nodeId)) {
              regionId = region.id;
              break;
            }
          }

          if (!regionId) return null;

          const pos = regionPositions.get(regionId);
          if (!pos) return null;

          const slot = (position as Record<string, unknown>).slot as number | undefined;
          const offsetX = slot ? (slot % 3) * 20 : 0;
          const offsetY = slot ? Math.floor(slot / 3) * 20 : 0;

          return (
            <circle
              key={entityId}
              cx={pos.x + REGION_WIDTH / 2 + offsetX - 10}
              cy={pos.y + REGION_HEIGHT / 2 + offsetY - 10}
              r={5}
              fill="#007bff"
            />
          );
        })}
      </g>
    </svg>
  );
};
