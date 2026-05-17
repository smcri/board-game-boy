/**
 * Assembler: final step that writes bundle.json, validates assets, and triggers scaffold build.
 * Implements caching per doc 06: cache key = sha256(scaffold-source + bundle.json + asset-manifest).
 * If cache miss: overwrites /apps/scaffold/game/* and runs `pnpm --filter @bgb/scaffold build`.
 * CLOSED: gap 4 - overwrite scaffold/game/* and run build
 * CLOSED: gap 5 - computeScaffoldHash walks scaffold sources
 */
import { BuildState, Bundle, BoardConfig } from '@bgb/shared';
import { emitSseEvent } from './sse.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { logger } from './logger.js';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

/**
 * Assemble the final bundle.
 */
export async function assembleBundle(state: BuildState): Promise<Partial<BuildState>> {
  // If the previous step halted for HITL, do not assemble. Pass the status through.
  if (state.status === 'awaiting_review') {
    return { status: 'awaiting_review' };
  }
  try {
    if (!state.rules_dsl || !state.asset_manifest) {
      // Return a structured error rather than throwing so callers can inspect
      // state.errors. The graph node never throws from assembler.
      return {
        status: 'error',
        errors: [...(state.errors ?? []), 'Missing RulesDsl or AssetManifest for assembly'],
      };
    }

    emitSseEvent(state.bundle_id, {
      type: 'update',
      status: 'assembling',
      node: 'assembler',
      message: 'Writing bundle.json...',
    });

    // Create bundle directory
    const bundleDir = join(config.BUNDLES_DIR, state.bundle_id);
    mkdirSync(bundleDir, { recursive: true });

    // Expand board topology into explicit nodes — stored in bundle.json so the
    // scaffold never needs to re-derive it at runtime (Option C design).
    const board_config = expandBoardConfig(state.rules_dsl);
    if (board_config) {
      logger.debug(
        { bundle_id: state.bundle_id, kind: board_config.kind, nodes: board_config.nodes.length },
        'Expanded board topology',
      );
    }

    // Create bundle.json (without conflicts_unresolved to keep playable shape clean)
    const bundle: Bundle = {
      bundle_id: state.bundle_id,
      version: '0.1.0',
      dsl_version: '1.0',
      rules_dsl: state.rules_dsl,
      asset_manifest: state.asset_manifest,
      build_warnings: Array.from(new Set(state.errors ?? [])),
      conflicts_resolved: (state.conflicts || []).filter((c) => c.resolution),
      conflicts_unresolved_non_blocking: (state.conflicts || []).filter((c) => !c.resolution && c.severity !== 'core_mechanic'),
      board_config: board_config ?? undefined,
      metadata: {
        game_name: state.rules_dsl.metadata.game_name,
        built_at: new Date().toISOString(),
        llm_provider: state.llm_provider,
        llm_model: state.llm_model,
        search_provider: state.search_provider,
        mode: state.mode,
      },
    };

    const bundlePath = join(bundleDir, 'bundle.json');
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

    // Validate every asset referenced in the manifest actually exists on disk.
    // Missing files would silently render as blank shapes at runtime, which is
    // a class of bug we want to surface at build time.
    const assetDir = join(bundleDir, 'assets');
    const missingAssets: string[] = [];
    for (const entry of state.asset_manifest.entries) {
      const assetPath = join(assetDir, entry.file);
      if (!existsSync(assetPath)) {
        missingAssets.push(entry.file);
      }
    }
    if (missingAssets.length > 0) {
      const msg = `Asset manifest references ${missingAssets.length} missing file(s): ${missingAssets.slice(0, 5).join(', ')}${missingAssets.length > 5 ? ` (+${missingAssets.length - 5} more)` : ''}`;
      logger.error({ bundle_id: state.bundle_id, missingAssets }, msg);
      return {
        status: 'error',
        errors: [...(state.errors ?? []), msg],
      };
    }

    // Compute cache key
    const scaffoldHash = computeScaffoldHash();
    const bundleHash = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
    const manifestHash = createHash('sha256').update(JSON.stringify(state.asset_manifest)).digest('hex');
    const cacheKey = createHash('sha256').update(`${scaffoldHash}${bundleHash}${manifestHash}`).digest('hex');

    logger.debug({ cacheKey }, 'Computed scaffold cache key');

    const cacheDir = join(config.BUNDLES_DIR, '.scaffold-cache', cacheKey);
    const cachedGameJs = join(cacheDir, 'game.js');

    let gamejsContent: string;

    if (existsSync(cachedGameJs)) {
      logger.info({ cacheKey }, 'Cache hit; copying cached game.js');
      gamejsContent = readFileSync(cachedGameJs, 'utf-8');
    } else {
      logger.info({ cacheKey }, 'Cache miss; rebuilding scaffold');

      // CLOSED: gap 4 - Overwrite /apps/scaffold/game/* before building
      try {
        const repoRoot = join(process.cwd(), '../..');
        const scaffoldDir = join(repoRoot, 'apps', 'scaffold');
        const scaffoldGameDir = join(scaffoldDir, 'game');

        // Create game directory
        mkdirSync(scaffoldGameDir, { recursive: true });

        // Write the three config files
        const bundleJsonPath = join(scaffoldGameDir, 'bundle.json');
        writeFileSync(bundleJsonPath, JSON.stringify(bundle, null, 2));
        logger.debug({ path: bundleJsonPath }, 'Wrote bundle.json to scaffold/game/');

        const boardConfigPath = join(scaffoldGameDir, 'board-config.json');
        // Board config comes from frontend_agent; for now write a minimal version
        const boardConfig = {
          game_name: state.rules_dsl.metadata.game_name,
          // Additional frontend-agent fields would go here
        };
        writeFileSync(boardConfigPath, JSON.stringify(boardConfig, null, 2));
        logger.debug({ path: boardConfigPath }, 'Wrote board-config.json to scaffold/game/');

        const assetManifestPath = join(scaffoldGameDir, 'asset-manifest.json');
        writeFileSync(assetManifestPath, JSON.stringify(state.asset_manifest, null, 2));
        logger.debug({ path: assetManifestPath }, 'Wrote asset-manifest.json to scaffold/game/');
      } catch (err) {
        logger.error({ error: String(err) }, 'Failed to write scaffold/game/* files');
        throw err;
      }

      // Run scaffold build (assumes pnpm is available in PATH)
      try {
        emitSseEvent(state.bundle_id, {
          type: 'update',
          status: 'assembling',
          node: 'assembler',
          message: 'Building scaffold...',
        });

        execSync('pnpm --filter @bgb/scaffold build', { cwd: join(process.cwd(), '../..'), stdio: 'inherit' });
      } catch (err) {
        logger.error({ error: String(err) }, 'Scaffold build failed');
        throw new Error(`Scaffold build failed: ${String(err)}`);
      }

      // Read dist/game.iife.js from scaffold (Vite lib.formats=['iife'] outputs .iife.js)
      const repoRoot = join(process.cwd(), '../..');
      const scaffoldDir = join(repoRoot, 'apps', 'scaffold');
      let scaffoldDistPath = join(scaffoldDir, 'dist', 'game.iife.js');

      // Fallback: try without .iife extension in case vite config changed
      if (!existsSync(scaffoldDistPath)) {
        scaffoldDistPath = join(scaffoldDir, 'dist', 'game.js');
      }

      // Last resort: walk dist/ and find the largest .js file
      if (!existsSync(scaffoldDistPath)) {
        const distDir = join(scaffoldDir, 'dist');
        if (existsSync(distDir)) {
          const files = readdirSync(distDir);
          const jsFiles = files.filter((f: string) => f.endsWith('.js'));
          if (jsFiles.length > 0) {
            const largest = jsFiles.reduce((a: string, b: string) => {
              const aSize = statSync(join(distDir, a)).size;
              const bSize = statSync(join(distDir, b)).size;
              return aSize > bSize ? a : b;
            });
            scaffoldDistPath = join(distDir, largest);
          }
        }
      }

      if (existsSync(scaffoldDistPath)) {
        gamejsContent = readFileSync(scaffoldDistPath, 'utf-8');

        // Cache it
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cachedGameJs, gamejsContent);
        logger.debug({ cacheKey }, 'Cached scaffold build output');
      } else {
        throw new Error(`Scaffold build produced no game.js at ${scaffoldDistPath}`);
      }
    }

    // Write game.js to bundle
    const gameJsPath = join(bundleDir, 'game.js');
    writeFileSync(gameJsPath, gamejsContent);

    logger.info({ bundle_id: state.bundle_id }, 'Bundle assembled');

    const bundleUrl = `/bundles/${state.bundle_id}/play`;

    return {
      status: 'done',
    };
  } catch (err) {
    const errorMsg = String(err);
    logger.error({ error: errorMsg }, 'Assembler failed');
    emitSseEvent(state.bundle_id, {
      type: 'error',
      node: 'assembler',
      message: errorMsg,
    });
    return {
      status: 'error',
      errors: [...(state.errors || []), errorMsg],
    };
  }
}

/**
 * Compute a hash of the scaffold source code.
 * CLOSED: gap 5 - walks scaffold/src, vite.config.ts, and index.html; skips game/*
 */
/**
 * Expand board topology from the DSL into a BoardConfig with explicit nodes.
 * Reads the entity with a BoardNode component; uses cols/rows/spaces/radius hints
 * or falls back to sensible defaults. Returns undefined if no BoardNode found.
 */
function expandBoardConfig(rules_dsl: BuildState['rules_dsl']): BoardConfig | undefined {
  if (!rules_dsl) return undefined;

  // Find the entity that describes the board topology.
  const boardEntity = rules_dsl.entities.find(
    (e) => e.components['BoardNode'],
  );
  if (!boardEntity) return undefined;

  const bn = boardEntity.components['BoardNode'] as Record<string, unknown>;
  const kind = String(bn.kind ?? 'grid_square');

  if (kind === 'grid_square') {
    const cols = Number(bn.cols ?? 8);
    const rows = Number(bn.rows ?? 8);
    const nodes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nodes.push({ id: `sq_${c}_${r}`, coords: { file: c, rank: r } });
      }
    }
    return { kind: 'grid_square', nodes };
  }

  if (kind === 'track') {
    const spaces = Number(bn.spaces ?? 100);
    const nodes = Array.from({ length: spaces + 1 }, (_, i) => ({
      id: `square_${i}`,
      coords: { index: i },
    }));
    return { kind: 'track', nodes };
  }

  if (kind === 'grid_hex') {
    const radius = Number(bn.radius ?? 5);
    const nodes = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        nodes.push({ id: `hex_${q}_${r}`, coords: { q, r } });
      }
    }
    return { kind: 'grid_hex', nodes };
  }

  if (kind === 'graph') {
    // Graph topology — nodes are defined by entities with BoardNode + Adjacency.
    // Collect all such entities.
    const nodes = rules_dsl.entities
      .filter((e) => e.components['BoardNode'])
      .map((e) => ({ id: e.id }));
    return { kind: 'graph', nodes };
  }

  return undefined;
}

function computeScaffoldHash(): string {
  try {
    const repoRoot = join(process.cwd(), '../..');
    const scaffoldDir = join(repoRoot, 'apps', 'scaffold');

    const hashes: Array<[string, string]> = [];

    // Walk scaffold/src/**
    const srcDir = join(scaffoldDir, 'src');
    if (existsSync(srcDir)) {
      const walked = walkDir(srcDir);
      for (const file of walked.sort()) {
        const content = readFileSync(file, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');
        const relpath = file.replace(srcDir, '.');
        hashes.push([relpath, hash]);
      }
    }

    // Include vite.config.ts
    const viteConfigPath = join(scaffoldDir, 'vite.config.ts');
    if (existsSync(viteConfigPath)) {
      const content = readFileSync(viteConfigPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      hashes.push(['vite.config.ts', hash]);
    }

    // Include index.html
    const indexPath = join(scaffoldDir, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      hashes.push(['index.html', hash]);
    }

    // Combine all hashes
    const combined = hashes.map((h) => `${h[0]}:${h[1]}`).join('|');
    const finalHash = createHash('sha256').update(combined).digest('hex');

    logger.debug({ finalHash }, 'Computed scaffold source hash');
    return finalHash;
  } catch (err) {
    logger.warn({ error: String(err) }, 'Failed to compute scaffold hash; using static fallback');
    return 'scaffold-hash-v1-fallback';
  }
}

/**
 * Recursively walk a directory and return all file paths (excluding node_modules and game/).
 */
function walkDir(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip game/ and node_modules
    if (entry.name === 'game' || entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}
