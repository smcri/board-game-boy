/**
 * Board renderer: queries BoardNode + Position entities.
 * Dispatches to per-kind sub-renderers.
 */

import React from 'react';
import { ComponentStore } from '../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { SquareBoard } from './board-kinds/square.js';
import { HexBoard } from './board-kinds/hex.js';
import { GraphBoard } from './board-kinds/graph.js';
import { TrackBoard } from './board-kinds/track.js';
import { RegionMapBoard } from './board-kinds/region.js';

interface BoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
}

/**
 * Render the board based on kind, dispatching to appropriate sub-renderer.
 */
export const Board: React.FC<BoardProps> = ({
  store,
  boardConfig,
  currentPlayer,
  assetManifest,
}) => {
  const boardNodes = store.getEntities('BoardNode');

  const props = {
    store,
    boardConfig,
    currentPlayer,
    assetManifest,
  };

  switch (boardConfig.kind) {
    case 'grid_square':
      return <SquareBoard {...props} />;
    case 'grid_hex':
      return <HexBoard {...props} />;
    case 'graph':
      return <GraphBoard {...props} />;
    case 'track':
      return <TrackBoard {...props} />;
    case 'region_map':
      return <RegionMapBoard {...props} />;
    default:
      return (
        <div style={{ padding: '10px', border: '1px solid #ccc' }}>
          <p>Board kind: {boardConfig.kind}</p>
          <p>Nodes: {boardNodes.length}</p>
        </div>
      );
  }
};
