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
