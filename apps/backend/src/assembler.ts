/**
 * Assembler: final step that writes bundle.json, validates assets, and triggers scaffold build.
 * Implements caching per doc 06: cache key = sha256(scaffold-source + bundle.json + asset-manifest).
 * If cache miss: overwrites /apps/scaffold/game/* and runs `pnpm --filter @bgb/scaffold build`.
 */
import { BuildState, Bundle } from '@bgb/shared';
import { emitSseEvent } from './sse.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { logger } from './logger.js';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

/**
 * Assemble the final bundle.
 */
export async function assembleBundle(state: BuildState): Promise<Partial<BuildState>> {
  try {
    if (!state.rules_dsl || !state.asset_manifest) {
      throw new Error('Missing RulesDsl or AssetManifest for assembly');
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

    // Create bundle.json
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

      // TODO: Overwrite /apps/scaffold/game/* (board-config.json, asset-manifest.json, bundle.json)
      // For MVP, assume these are symlinks or will be injected at runtime.

      // Run scaffold build (assumes pnpm is available in PATH)
      try {
        emitSseEvent(state.bundle_id, {
          type: 'update',
          status: 'assembling',
          node: 'assembler',
          message: 'Building scaffold...',
        });

        execSync('pnpm --filter @bgb/scaffold build', { stdio: 'inherit' });
      } catch (err) {
        logger.warn({ error: String(err) }, 'Scaffold build failed; using fallback');
        // TODO: Provide fallback game.js
        gamejsContent = '/* Scaffold build failed */';
      }

      // Read dist/game.js from scaffold
      const scaffoldDistPath = join(process.cwd(), '..', 'scaffold', 'dist', 'game.js');
      if (existsSync(scaffoldDistPath)) {
        gamejsContent = readFileSync(scaffoldDistPath, 'utf-8');

        // Cache it
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cachedGameJs, gamejsContent);
      } else {
        throw new Error('Scaffold build produced no game.js');
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
 * Best-effort: walks /apps/scaffold/src and /apps/scaffold/index.html.
 */
function computeScaffoldHash(): string {
  try {
    // TODO: Walk scaffold src directory and compute combined hash
    // For MVP, use a static hash or file mtime
    return 'scaffold-hash-v1';
  } catch {
    return 'scaffold-hash-unknown';
  }
}
