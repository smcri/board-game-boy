/**
 * Main entry point: exposes window.BGB.boot(rootEl, bundleData) for IIFE.
 * In dev mode, fetches /game/bundle.json and mounts.
 */

import { Bundle, BoardConfig } from '@bgb/shared';
import { mount } from './mount.js';

/**
 * Boot the game with bundle data.
 * Called by the backend or dev mode.
 */
async function boot(
  rootEl: HTMLElement,
  bundleData: unknown,
  boardConfigData?: unknown,
): Promise<void> {
  // Validate bundle
  const bundleResult = Bundle.safeParse(bundleData);
  if (!bundleResult.success) {
    console.error('Invalid bundle:', bundleResult.error);
    rootEl.innerHTML = '<p style="color: red;">Invalid game bundle.</p>';
    return;
  }

  let boardConfig: BoardConfig;
  if (boardConfigData) {
    const boardResult = BoardConfig.safeParse(boardConfigData);
    if (!boardResult.success) {
      console.error('Invalid board config:', boardResult.error);
      rootEl.innerHTML = '<p style="color: red;">Invalid board configuration.</p>';
      return;
    }
    boardConfig = boardResult.data;
  } else {
    // Use a default empty board config
    boardConfig = { kind: 'grid_square', nodes: [] };
  }

  mount(rootEl, bundleResult.data, boardConfig);
}

// Expose window.BGB.boot for IIFE builds
declare global {
  interface Window {
    BGB: {
      boot: typeof boot;
    };
  }
}

if (typeof window !== 'undefined') {
  window.BGB = { boot };
}

// Dev mode: auto-fetch and mount if running under Vite dev server
if (import.meta.env.DEV) {
  (async () => {
    try {
      const rootEl = document.getElementById('root');
      if (!rootEl) {
        console.error('Root element not found');
        return;
      }

      // Fetch bundle and board config from dev server
      const bundleRes = await fetch('/game/bundle.json');
      const bundleData = await bundleRes.json();

      const boardRes = await fetch('/game/board-config.json');
      const boardConfigData = await boardRes.json();

      await boot(rootEl, bundleData, boardConfigData);
    } catch (e) {
      console.error('Dev mode boot failed:', e);
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.innerHTML = `<p style="color: red;">Boot error: ${String(e)}</p>`;
      }
    }
  })();
}

export { boot };
