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

    // Assert board is rendered
    const boardSvg = screen.getByRole('img', { hidden: true });
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

    // Assert player panels
    expect(screen.getByText(/Player \d+/)).toBeTruthy();
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
});
