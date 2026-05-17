/**
 * graph board renderer: generic node-link graph.
 * Uses BoardConfig.nodes with explicit coords if provided;
 * otherwise applies a simple deterministic circular layout.
 */

import React from 'react';
import { ComponentStore } from '../../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from '../visibility.js';

interface GraphBoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
}

function nodeCircleLayout(
  nodeCount: number,
  radius: number,
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  for (let i = 0; i < nodeCount; i++) {
    const angle = (2 * Math.PI * i) / nodeCount;
    const x = radius + radius * Math.cos(angle);
    const y = radius + radius * Math.sin(angle);
    positions.set(i, { x, y });
  }
  return positions;
}

export const GraphBoard: React.FC<GraphBoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
}) => {
  const nodePositions = new Map<string, { x: number; y: number }>();
  const positions = store.getEntities('Position');

  // Populate node positions: explicit coords or circular layout
  const nodeCount = boardConfig.nodes.length;
  const layoutRadius = Math.max(100, nodeCount * 10);
  const circleLayout = nodeCircleLayout(nodeCount, layoutRadius);

  for (let i = 0; i < boardConfig.nodes.length; i++) {
    const node = boardConfig.nodes[i];
    if (!node) continue;

    if (node.coords) {
      const x = (node.coords.x as number) ?? 0;
      const y = (node.coords.y as number) ?? 0;
      nodePositions.set(node.id, { x, y });
    } else {
      const circlePos = circleLayout.get(i);
      if (circlePos) {
        nodePositions.set(node.id, circlePos);
      }
    }
  }

  // Calculate bounds
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  let first = true;
  for (const pos of nodePositions.values()) {
    if (first) {
      minX = maxX = pos.x;
      minY = maxY = pos.y;
      first = false;
    } else {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }
  }

  const padding = 40;
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;

  return (
    <svg
      width={Math.max(width, 200)}
      height={Math.max(height, 200)}
      style={{ border: '1px solid #ccc', backgroundColor: '#f9f9f9' }}
      role="img"
      aria-label="graph-board"
    >
      <g transform={`translate(${padding - minX}, ${padding - minY})`}>
        {/* Render edges */}
        {boardConfig.nodes.map((node) => {
          if (!node.neighbours) return null;

          const fromPos = nodePositions.get(node.id);
          if (!fromPos) return null;

          return node.neighbours.map((neighbourId, idx) => {
            const toPos = nodePositions.get(neighbourId);
            if (!toPos) return null;

            const edgeKey = `${node.id}-${neighbourId}-${idx}`;
            return (
              <line
                key={edgeKey}
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                stroke="#999"
                strokeWidth={1}
              />
            );
          });
        })}

        {/* Render nodes */}
        {boardConfig.nodes.map((node) => {
          const pos = nodePositions.get(node.id);
          if (!pos) return null;

          return (
            <circle
              key={node.id}
              cx={pos.x}
              cy={pos.y}
              r={8}
              fill="#ddd"
              stroke="#999"
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

          const pos = nodePositions.get(nodeId);
          if (!pos) return null;

          return (
            <circle
              key={entityId}
              cx={pos.x}
              cy={pos.y}
              r={6}
              fill="#007bff"
            />
          );
        })}
      </g>
    </svg>
  );
};
