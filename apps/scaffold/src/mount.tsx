/**
 * Mount function: validates bundle, creates engine, mounts App.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Bundle, BoardConfig } from '@bgb/shared';
import { createEngine } from './engine/index.js';
import { App } from './renderer/App.js';

/**
 * Mount the game in a DOM element.
 * @param rootEl - The DOM element to mount into
 * @param bundle - The game bundle (validated)
 * @param boardConfig - The board configuration
 */
export function mount(
  rootEl: HTMLElement,
  bundle: Bundle,
  boardConfig: BoardConfig,
): void {
  // Validate bundle (already done by caller, but double-check)
  const bundleResult = Bundle.safeParse(bundle);
  if (!bundleResult.success) {
    console.error('Invalid bundle:', bundleResult.error);
    rootEl.innerHTML = '<p style="color: red;">Invalid game bundle.</p>';
    return;
  }

  // Create engine
  const engine = createEngine(bundle);

  // Validate board config
  const boardResult = BoardConfig.safeParse(boardConfig);
  if (!boardResult.success) {
    console.error('Invalid board config:', boardResult.error);
    rootEl.innerHTML = '<p style="color: red;">Invalid board configuration.</p>';
    return;
  }

  // Seed the ECS store with board node entities from boardConfig.nodes.
  // boardConfig comes from bundle.board_config (expanded by assembler at build time — Option C).
  // The square/track/hex renderers read store.getEntities('BoardNode') to draw squares.
  // Only seed nodes not already in the store (LLM-generated node entities take precedence).
  const store = engine.getStore();
  const validConfig = boardResult.data;
  const existingBoardNodes = new Set(store.getEntities('BoardNode'));

  for (const node of validConfig.nodes) {
    if (!existingBoardNodes.has(node.id)) {
      // coords is a generic Record<string, number|string> from BoardConfig.nodes.
      // The renderer reads coords.file/coords.rank (grid_square) or coords.index (track).
      store.addComponent(node.id, 'BoardNode', {
        kind: validConfig.kind,
        coords: node.coords ?? {},
      });
      store.addComponent(node.id, 'Identity', { name: node.id, kind: 'board_node' });
    }
  }

  // Mount React app
  const root = createRoot(rootEl);
  root.render(
    <App engine={engine} bundle={bundle} boardConfig={boardResult.data} />,
  );

  // Signal to the play page that the game mounted successfully.
  if (typeof window !== 'undefined' && typeof (window as Window & { __gameMounted?: () => void }).__gameMounted === 'function') {
    (window as Window & { __gameMounted?: () => void }).__gameMounted!();
  }
}
