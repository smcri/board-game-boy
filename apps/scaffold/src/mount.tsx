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

  // Seed the ECS store with board node entities from boardConfig.
  // The renderers read BoardNode entities from the store, not from boardConfig directly.
  // Only seed nodes that aren't already in the store (LLM may have generated them explicitly).
  const store = engine.getStore();
  const validConfig = boardResult.data;
  const existingBoardNodes = store.getEntities('BoardNode');

  if (validConfig.kind === 'grid_square') {
    for (const node of (validConfig as { kind: 'grid_square'; nodes: Array<{ id: string; coords: { file: number; rank: number } }> }).nodes) {
      if (!existingBoardNodes.includes(node.id)) {
        store.addComponent(node.id, 'BoardNode', { kind: 'grid_square', coords: node.coords });
        store.addComponent(node.id, 'Identity', { name: node.id, kind: 'board_node' });
      }
    }
  } else if (validConfig.kind === 'track') {
    for (const node of (validConfig as { kind: 'track'; nodes: Array<{ id: string; index: number }> }).nodes) {
      if (!existingBoardNodes.includes(node.id)) {
        store.addComponent(node.id, 'BoardNode', { kind: 'track', index: node.index });
        store.addComponent(node.id, 'Identity', { name: node.id, kind: 'board_node' });
      }
    }
  } else if (validConfig.kind === 'grid_hex') {
    for (const node of (validConfig as { kind: 'grid_hex'; nodes: Array<{ id: string; q: number; r: number }> }).nodes) {
      if (!existingBoardNodes.includes(node.id)) {
        store.addComponent(node.id, 'BoardNode', { kind: 'grid_hex', q: node.q, r: node.r });
        store.addComponent(node.id, 'Identity', { name: node.id, kind: 'board_node' });
      }
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
