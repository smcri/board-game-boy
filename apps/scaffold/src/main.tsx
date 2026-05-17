/**
 * Main entry point: exposes window.BGB.boot(rootEl, bundleData) for IIFE.
 * In dev mode, fetches /game/bundle.json and mounts.
 */

import { Bundle, BoardConfig } from '@bgb/shared';
import { mount } from './mount.js';

/**
 * Derive a BoardConfig from the bundle's DSL entities.
 * Looks for an entity with a BoardNode component and auto-generates grid nodes.
 */
function deriveBoardConfig(bundle: Bundle): BoardConfig {
  const entities = bundle.rules_dsl.entities;

  // Find the board entity
  const boardEntity = entities.find((e) => e.components['BoardNode']);
  const boardNode = boardEntity?.components['BoardNode'] as Record<string, unknown> | undefined;
  const kind = (boardNode?.kind as string) ?? 'grid_square';

  if (kind === 'grid_square') {
    // Default 8×8 grid (Chess, Checkers, etc.)
    const cols = (boardNode?.cols as number) ?? 8;
    const rows = (boardNode?.rows as number) ?? 8;
    const nodes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nodes.push({ id: `sq_${c}_${r}`, coords: { file: c, rank: r } });
      }
    }
    return { kind: 'grid_square', nodes };
  }

  if (kind === 'track') {
    // Default 100-space track (Snakes & Ladders, etc.)
    const spaces = (boardNode?.spaces as number) ?? 100;
    const nodes = Array.from({ length: spaces }, (_, i) => ({
      id: `space_${i}`,
      index: i,
    }));
    return { kind: 'track', nodes };
  }

  if (kind === 'grid_hex') {
    // Default 5-radius hex grid
    const radius = (boardNode?.radius as number) ?? 5;
    const nodes = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        nodes.push({ id: `hex_${q}_${r}`, q, r });
      }
    }
    return { kind: 'grid_hex', nodes };
  }

  // Fallback: empty grid_square
  return { kind: 'grid_square', nodes: [] };
}

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
    // Derive board config from the bundle's DSL entities.
    boardConfig = deriveBoardConfig(bundleResult.data);
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
