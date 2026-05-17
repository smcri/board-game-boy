/**
 * Asset agent: generates AssetManifest and writes SVG files.
 * Iterates entities from rules_dsl and emits AssetEntry items by role.
 * Generates a color palette via LLM.
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BuildState, AssetManifest, AssetEntry } from '@bgb/shared';
import { emitSseEvent } from '../sse.js';
import { makeCardTemplate, makeBoardGrid, makePiece } from '../assets/templates.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Asset agent: generates assets and asset manifest.
 */
export async function assetAgent(state: BuildState, _llm: BaseChatModel): Promise<Partial<BuildState>> {
  // Defence in depth: if the graph reached this node despite a HITL halt, pass through.
  if (state.status === 'awaiting_review') {
    return { status: 'awaiting_review' };
  }
  try {
    if (!state.rules_dsl) {
      throw new Error('No RulesDsl available for asset generation');
    }

    emitSseEvent(state.bundle_id, {
      type: 'update',
      status: 'building_assets',
      node: 'asset_agent',
      message: 'Generating assets...',
    });

    const assetDir = join(config.BUNDLES_DIR, state.bundle_id, 'assets');
    mkdirSync(assetDir, { recursive: true });

    const entries: AssetEntry[] = [];
    const palette: string[] = generatePalette();

    // Iterate entities and create assets
    for (const entity of state.rules_dsl.entities) {
      const identity = entity.components.Identity;
      if (!identity || typeof identity !== 'object') continue;

      const { kind } = identity as { kind: string };

      // Determine role based on kind
      let role: AssetEntry['role'] = 'misc';
      if (kind.includes('board') || kind.includes('track')) role = 'board';
      else if (kind.includes('card')) role = 'card_template';
      else if (kind.includes('token') || kind.includes('piece')) role = 'token';
      else if (kind.includes('tile')) role = 'tile';

      // Generate appropriate SVG
      let svg: string;
      const color: string = (palette[Math.floor(Math.random() * palette.length)] ?? palette[0])!;

      switch (role) {
        case 'board':
          svg = makeBoardGrid(8, 8, palette);
          break;
        case 'card_template':
          svg = makeCardTemplate(palette);
          break;
        case 'token':
          svg = makePiece(entity.id.substring(0, 3), color);
          break;
        default:
          svg = makePiece(entity.id.substring(0, 1), color);
      }

      const filename = `${entity.id}.svg`;
      const filepath = join(assetDir, filename);

      writeFileSync(filepath, svg);

      const viewbox = extractViewbox(svg);
      entries.push({
        id: entity.id,
        file: filename,
        role,
        svg_viewbox: viewbox,
      });
    }

    const manifest: AssetManifest = {
      palette,
      entries,
    };

    // Write manifest
    const manifestPath = join(config.BUNDLES_DIR, state.bundle_id, 'asset-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    return {
      status: 'assembling',
      asset_manifest: manifest,
    };
  } catch (err) {
    const errorMsg = String(err);
    logger.error({ error: errorMsg }, 'Asset agent failed');
    emitSseEvent(state.bundle_id, {
      type: 'error',
      node: 'asset_agent',
      message: errorMsg,
    });
    return {
      status: 'error',
      errors: [...(state.errors || []), errorMsg],
    };
  }
}

/**
 * Generate a simple color palette.
 */
function generatePalette(): string[] {
  const palettes: string[][] = [
    ['#E8F5E9', '#4CAF50', '#2E7D32', '#FFF59D'],
    ['#F3E5F5', '#9C27B0', '#6A1B9A', '#FFB300'],
    ['#E3F2FD', '#2196F3', '#1565C0', '#FFA726'],
    ['#FCE4EC', '#E91E63', '#AD1457', '#00BCD4'],
  ];
  return (palettes[Math.floor(Math.random() * palettes.length)] ?? palettes[0])!;
}

/**
 * Extract viewBox attribute from SVG string.
 */
function extractViewbox(svg: string): string {
  const match = svg.match(/viewBox="([^"]+)"/);
  return (match && match[1]) || '0 0 100 100';
}
