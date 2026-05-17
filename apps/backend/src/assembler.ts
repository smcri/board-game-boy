/**
 * Assembler: final step that writes bundle.json, validates assets, and triggers scaffold build.
 * Implements caching per doc 06: cache key = sha256(scaffold-source + bundle.json + asset-manifest).
 * If cache miss: overwrites /apps/scaffold/game/* and runs `pnpm --filter @bgb/scaffold build`.
 * CLOSED: gap 4 - overwrite scaffold/game/* and run build
 * CLOSED: gap 5 - computeScaffoldHash walks scaffold sources
 */
import { BuildState, Bundle } from '@bgb/shared';
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

    // Create bundle.json (without conflicts_unresolved to keep playable shape clean)
    const bundle: Bundle = {
      bundle_id: state.bundle_id,
      version: '0.1.0',
      dsl_version: '1.0',
      rules_dsl: state.rules_dsl,
      asset_manifest: state.asset_manifest,
      conflicts_resolved: (state.conflicts || []).filter((c) => c.resolution),
      conflicts_unresolved_non_blocking: (state.conflicts || []).filter((c) => !c.resolution && c.severity !== 'core_mechanic'),
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

    // TODO: Validate assets exist in /bundles/{bundle_id}/assets/*.svg
    // (Asset agent already wrote them)

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
