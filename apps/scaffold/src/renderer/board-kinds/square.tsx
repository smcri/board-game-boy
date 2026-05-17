/**
 * grid_square board renderer — with checkerboard, multi-player colors, click-to-move.
 */

import React, { useState } from 'react';
import { ComponentStore } from '../../engine/ecs.js';
import { BoardConfig, EntityId } from '@bgb/shared';
import { isVisibleToCurrentPlayer } from '../visibility.js';

interface SquareBoardProps {
  store: ComponentStore;
  boardConfig: BoardConfig;
  currentPlayer: EntityId | undefined;
  assetManifest?: Record<string, unknown>;
  onAction?: (actionId: string, params: Record<string, unknown>) => void;
}

const SQUARE_SIZE = 48;
const PADDING = 4;

// Player seat index → color (up to 6 players)
const PLAYER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

// Chess/checkers piece symbols
const TOKEN_SYMBOLS: Record<string, string> = {
  king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙',
  checker: '●', disc: '◉', meeple: '⚑', marker: '▲', token: '◆', piece: '■',
};

function getPlayerColor(ownerEntityId: string | undefined, allPlayers: string[]): string {
  if (!ownerEntityId) return '#6b7280';
  const idx = allPlayers.indexOf(ownerEntityId);
  return PLAYER_COLORS[Math.max(0, idx) % PLAYER_COLORS.length] ?? '#6b7280';
}

function getPieceLabel(
  token: Record<string, unknown> | undefined,
  identity: Record<string, unknown> | undefined,
): string {
  const kind = token?.kind as string | undefined;
  if (kind) {
    const sym = TOKEN_SYMBOLS[kind.toLowerCase()];
    if (sym) return sym;
    return kind.slice(0, 1).toUpperCase();
  }
  const name = identity?.name as string | undefined;
  if (name) return name.slice(0, 1).toUpperCase();
  return '?';
}

export const SquareBoard: React.FC<SquareBoardProps> = ({
  store,
  boardConfig: _boardConfig,
  currentPlayer,
  onAction,
}) => {
  const [selectedPiece, setSelectedPiece] = useState<EntityId | null>(null);

  const boardNodes = store.getEntities('BoardNode');
  const positions = store.getEntities('Position');

  // All player entities sorted by seat for color assignment
  const allPlayers = store.getEntities('Player').sort((a, b) => {
    const sa = ((store.getComponent(a, 'Player') as Record<string, unknown>)?.seat as number) ?? 0;
    const sb = ((store.getComponent(b, 'Player') as Record<string, unknown>)?.seat as number) ?? 0;
    return sa - sb;
  });

  // Compute SVG size from nodes
  let maxFile = 0; let maxRank = 0;
  for (const nodeId of boardNodes) {
    const n = store.getComponent(nodeId, 'BoardNode') as Record<string, unknown> | undefined;
    const c = n?.coords as Record<string, number> | undefined;
    if (c) { maxFile = Math.max(maxFile, c.file ?? 0); maxRank = Math.max(maxRank, c.rank ?? 0); }
  }
  const svgW = (maxFile + 1) * SQUARE_SIZE + PADDING * 2;
  const svgH = (maxRank + 1) * SQUARE_SIZE + PADDING * 2;

  // nodeId → pixel rect origin + center
  const nodePixels = new Map<string, { x: number; y: number; cx: number; cy: number }>();
  for (const nodeId of boardNodes) {
    const n = store.getComponent(nodeId, 'BoardNode') as Record<string, unknown> | undefined;
    const c = n?.coords as Record<string, number> | undefined;
    if (c) {
      const x = PADDING + (c.file ?? 0) * SQUARE_SIZE;
      const y = PADDING + (c.rank ?? 0) * SQUARE_SIZE;
      nodePixels.set(nodeId, { x, y, cx: x + SQUARE_SIZE / 2, cy: y + SQUARE_SIZE / 2 });
    }
  }

  // nodeId → list of pieces on it (for stacking)
  const piecesOnNode = new Map<string, EntityId[]>();
  for (const eid of positions) {
    const pos = store.getComponent(eid, 'Position') as Record<string, unknown> | undefined;
    if (pos?.['on'] === 'board') {
      const nid = pos['node'] as string;
      if (nid) { if (!piecesOnNode.has(nid)) piecesOnNode.set(nid, []); piecesOnNode.get(nid)!.push(eid); }
    }
  }

  const handleNodeClick = (nodeId: string) => {
    if (!onAction) return;
    if (selectedPiece) {
      // Convention: primary movement action is always named 'move' (Option A)
      onAction('move', { piece: selectedPiece, to: nodeId });
      setSelectedPiece(null);
      return;
    }
    // Select own piece on this square
    const here = piecesOnNode.get(nodeId) ?? [];
    const mine = here.find((eid) => {
      const owner = store.getComponent(eid, 'Owner') as Record<string, unknown> | undefined;
      return owner?.player_entity === currentPlayer;
    });
    if (mine) setSelectedPiece(mine);
  };

  return (
    <div>
      {selectedPiece && (
        <div style={{ marginBottom: 8, padding: '4px 8px', background: '#fef9c3', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}>
          ✋ Piece selected — click a destination square to move
          <button onClick={() => setSelectedPiece(null)} style={{ marginLeft: 8, cursor: 'pointer' }}>✕ Cancel</button>
        </div>
      )}
      <svg
        width={svgW}
        height={svgH}
        style={{ border: '1px solid #888', display: 'block', cursor: selectedPiece ? 'crosshair' : 'default' }}
        role="img"
        aria-label="square-board"
      >
        {/* Squares */}
        {boardNodes.map((nodeId) => {
          const px = nodePixels.get(nodeId);
          if (!px) return null;
          const n = store.getComponent(nodeId, 'BoardNode') as Record<string, unknown> | undefined;
          const c = n?.coords as Record<string, number> | undefined;
          if (!c) return null;
          const isLight = ((c.file ?? 0) + (c.rank ?? 0)) % 2 === 0;
          return (
            <rect
              key={nodeId}
              x={px.x} y={px.y}
              width={SQUARE_SIZE} height={SQUARE_SIZE}
              fill={isLight ? '#f0d9b5' : '#b58863'}
              stroke={selectedPiece ? '#fbbf24' : '#555'}
              strokeWidth={selectedPiece ? 1.5 : 0.5}
              style={{ cursor: onAction ? 'pointer' : 'default' }}
              onClick={() => { console.log('[square click]', nodeId); handleNodeClick(nodeId); }}
            />
          );
        })}

        {/* Pieces */}
        {positions.map((eid) => {
          const pos = store.getComponent(eid, 'Position') as Record<string, unknown> | undefined;
          if (!pos || pos['on'] !== 'board') return null;
          const nodeId = pos['node'] as string | undefined;
          if (!nodeId) return null;
          const px = nodePixels.get(nodeId);
          if (!px) return null;
          if (!currentPlayer || !isVisibleToCurrentPlayer(store, eid, currentPlayer)) return null;

          const token = store.getComponent(eid, 'Token') as Record<string, unknown> | undefined;
          const identity = store.getComponent(eid, 'Identity') as Record<string, unknown> | undefined;
          const owner = store.getComponent(eid, 'Owner') as Record<string, unknown> | undefined;
          const ownerPlayer = owner?.player_entity as string | undefined;
          const fill = getPlayerColor(ownerPlayer, allPlayers);
          const label = getPieceLabel(token, identity);
          const isSelected = selectedPiece === eid;

          // Stack offset — spread pieces on same square so they don't fully overlap
          const stack = piecesOnNode.get(nodeId) ?? [];
          const stackIdx = stack.indexOf(eid);
          const ox = stackIdx * 10; const oy = stackIdx * -10;
          const r = SQUARE_SIZE / 2 - 5;

          return (
            <g
              key={eid}
              style={{ cursor: onAction && ownerPlayer === currentPlayer ? 'grab' : 'default' }}
              onClick={(e) => {
                console.log('[piece click]', { eid, ownerPlayer, currentPlayer, onAction: !!onAction });
                if (!onAction || ownerPlayer !== currentPlayer) {
                  // Not my piece — don't block, let click fall through to square
                  return;
                }
                e.stopPropagation(); // Only stop propagation for own pieces
                setSelectedPiece(isSelected ? null : eid);
              }}
            >
              <circle cx={px.cx + ox} cy={px.cy + oy} r={r} fill={fill} stroke={isSelected ? '#fbbf24' : 'white'} strokeWidth={isSelected ? 3 : 2} />
              <text x={px.cx + ox} y={px.cy + oy + 5} textAnchor="middle" fontSize={16} fill="white" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
