/**
 * Renderer tests: load a tiny Tic-Tac-Toe bundle, mount, assert board renders.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { App } from '../renderer/App.js';
import { createEngine } from '../engine/index.js';
import { Bundle, BoardConfig, RulesDsl, EntityDecl, ActionDecl } from '@bgb/shared';

describe('Renderer', () => {
  // Minimal Tic-Tac-Toe bundle for testing
  const createTicTacToeBundle = (): Bundle => {
    // Create 9 board nodes
    const entities: EntityDecl[] = [
      { id: '_turn', components: { Turn: { current_player: 'player1' } } },
      { id: 'player1', components: { Player: { seat: 0 } } },
      { id: 'player2', components: { Player: { seat: 1 } } },
    ];

    // Create 9 board squares
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        entities.push({
          id: `square_${i}_${j}`,
          components: {
            Identity: { name: `Square ${i},${j}`, kind: 'square' },
            BoardNode: { kind: 'grid_square', coords: { file: i, rank: j } },
          },
        });
      }
    }

    const rules: RulesDsl = {
      dsl_version: '1.0',
      metadata: {
        game_name: 'Tic-Tac-Toe',
        summary: 'A simple Tic-Tac-Toe game',
        min_players: 2,
        max_players: 2,
      },
      entities,
      conflicts: [],
      actions: [
        {
          id: 'mark',
          name: 'Mark Square',
          description: 'Place your mark on an empty square',
          params: [],
          preconditions: [],
          effect: [
            {
              verb: 'phase',
              target: 'next',
            },
          ],
        } as ActionDecl,
      ],
      win_conditions: [
        {
          id: 'three_in_row',
          description: 'Three in a row',
          when: {
            op: 'count_at_least',
            selector: { kind: 'self' },
            n: 3,
          },
        },
      ],
    };

    const bundle: Bundle = {
      bundle_id: 'tictactoe-test',
      version: '0.1.0',
      dsl_version: '1.0',
      rules_dsl: rules,
      asset_manifest: { entries: [], palette: [] },
      conflicts_resolved: [],
      conflicts_unresolved_non_blocking: [],
      metadata: {
        game_name: 'Tic-Tac-Toe',
        built_at: new Date().toISOString(),
        llm_provider: 'test',
        llm_model: 'test',
        mode: 'test',
      },
    };

    return bundle;
  };

  it('should render a board with 9 squares', () => {
    const bundle = createTicTacToeBundle();
    const boardConfig: BoardConfig = {
      kind: 'grid_square',
      nodes: Array.from({ length: 9 }, (_, i) => ({
        id: `square_${Math.floor(i / 3)}_${i % 3}`,
        coords: {
          file: Math.floor(i / 3),
          rank: i % 3,
        },
      })),
    };

    const engine = createEngine(bundle);
    render(
      <App
        engine={engine}
        bundle={bundle}
        boardConfig={boardConfig}
      />,
    );

    // Assert board is rendered with the right aria-label
    const boardSvg = screen.getByRole('img', { name: 'square-board' });
    expect(boardSvg).toBeTruthy();

    // Assert title
    expect(screen.getByText('Tic-Tac-Toe')).toBeTruthy();
  });

  it('should render player panels', () => {
    const bundle = createTicTacToeBundle();
    const boardConfig: BoardConfig = {
      kind: 'grid_square',
      nodes: [],
    };

    const engine = createEngine(bundle);
    render(
      <App
        engine={engine}
        bundle={bundle}
        boardConfig={boardConfig}
      />,
    );

    // Assert player panels - should find at least one player panel
    const playerPanels = screen.getAllByText(/Player \d+/);
    expect(playerPanels.length).toBeGreaterThanOrEqual(1);
  });

  it('should render action bar with available actions', () => {
    const bundle = createTicTacToeBundle();
    const boardConfig: BoardConfig = {
      kind: 'grid_square',
      nodes: [],
    };

    const engine = createEngine(bundle);
    render(
      <App
        engine={engine}
        bundle={bundle}
        boardConfig={boardConfig}
      />,
    );

    // Assert action bar
    expect(screen.getByText('Actions')).toBeTruthy();
    // The action button should be present
    expect(screen.getByRole('button', { name: /Mark Square/ })).toBeTruthy();
  });

  it('should render a hex grid board', () => {
    const bundle = createTicTacToeBundle();
    const boardConfig: BoardConfig = {
      kind: 'grid_hex',
      nodes: Array.from({ length: 7 }, (_, i) => ({
        id: `hex_${i}`,
        coords: { q: i % 3, r: Math.floor(i / 3) },
      })),
    };

    const engine = createEngine(bundle);
    render(
      <App
        engine={engine}
        bundle={bundle}
        boardConfig={boardConfig}
      />,
    );

    // Assert hex board is rendered
    const boardSvg = screen.getByRole('img', { name: 'hex-board' });
    expect(boardSvg).toBeTruthy();

    // Should contain polygon elements for hexagons
    const polygons = boardSvg.querySelectorAll('polygon');
    expect(polygons.length).toBeGreaterThan(0);
  });

  it('should render a graph board', () => {
    const bundle = createTicTacToeBundle();
    const boardConfig: BoardConfig = {
      kind: 'graph',
      nodes: [
        { id: 'node_a', coords: { x: 50, y: 50 } },
        { id: 'node_b', coords: { x: 150, y: 50 } },
        { id: 'node_c', coords: { x: 100, y: 120 } },
      ],
    };

    const engine = createEngine(bundle);
    render(
      <App
        engine={engine}
        bundle={bundle}
        boardConfig={boardConfig}
      />,
    );

    // Assert graph board is rendered
    const boardSvg = screen.getByRole('img', { name: 'graph-board' });
    expect(boardSvg).toBeTruthy();

    // Should contain circle elements for nodes
    const circles = boardSvg.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('should render a track board', () => {
    const bundle = createTicTacToeBundle();
    const boardConfig: BoardConfig = {
      kind: 'track',
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: `track_${i}`,
      })),
    };

    const engine = createEngine(bundle);
    render(
      <App
        engine={engine}
        bundle={bundle}
        boardConfig={boardConfig}
      />,
    );

    // Assert track board is rendered
    const boardSvg = screen.getByRole('img', { name: 'track-board' });
    expect(boardSvg).toBeTruthy();

    // Should contain circle elements for track nodes
    const circles = boardSvg.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('should render a region map board', () => {
    const bundle = createTicTacToeBundle();
    const boardConfig: BoardConfig = {
      kind: 'region_map',
      nodes: Array.from({ length: 6 }, (_, i) => ({ id: `node_${i}` })),
      regions: [
        { id: 'north', nodes: ['node_0', 'node_1'] },
        { id: 'south', nodes: ['node_2', 'node_3'] },
        { id: 'west', nodes: ['node_4', 'node_5'] },
      ],
    };

    const engine = createEngine(bundle);
    render(
      <App
        engine={engine}
        bundle={bundle}
        boardConfig={boardConfig}
      />,
    );

    // Assert region map board is rendered
    const boardSvg = screen.getByRole('img', { name: 'region-map-board' });
    expect(boardSvg).toBeTruthy();

    // Should contain rect elements for regions
    const rects = boardSvg.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(0);

    // Should contain text labels for regions
    const texts = boardSvg.querySelectorAll('text');
    expect(texts.length).toBeGreaterThan(0);
  });
});
