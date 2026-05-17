/**
 * Asset agent: generates AssetManifest and writes SVG files.
 *
 * Two-stage:
 *   1. LLM proposes an AssetPlan (theme, palette, per-entity glyph + label).
 *      If the LLM call fails or the plan is invalid, we fall back to a
 *      deterministic palette and entity-id-based labels — the build still
 *      succeeds.
 *   2. Deterministic SVG templates apply the plan to produce on-disk assets.
 *
 * This split keeps creative work (colors, themes, labels) LLM-driven while
 * the safety-critical step (writing valid SVG to disk) stays deterministic.
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BuildState, AssetManifest, AssetEntry } from '@bgb/shared';
import { emitSseEvent } from '../sse.js';
import { makeCardTemplate, makeBoardGrid, makePiece } from '../assets/templates.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { llmJsonRetry } from '../llm-retry.js';
import { makeLlm } from '../llm.js';
import { z } from 'zod';

// Allowed CSS color formats: #RGB, #RRGGBB, or named CSS colors.
const colorString = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/, 'must be a hex color or CSS color name');

const AssetPlanSchema = z.object({
  theme_name: z.string().min(1).max(60),
  palette: z.array(colorString).min(4).max(8),
  entities: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(8), // 1-8 char glyph/abbreviation for the SVG
        color_index: z.number().int().min(0).max(7), // index into palette
      }),
    )
    .max(64),
});
type AssetPlan = z.infer<typeof AssetPlanSchema>;

/**
 * Asset agent: generates assets and asset manifest.
 */
export async function assetAgent(state: BuildState, llm: BaseChatModel): Promise<Partial<BuildState>> {
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
      message: 'Generating asset plan via LLM...',
    });

    const assetDir = join(config.BUNDLES_DIR, state.bundle_id, 'assets');
    mkdirSync(assetDir, { recursive: true });

    // 1. Ask the LLM for a coherent asset plan (theme, palette, glyphs).
    //    Falls back to a deterministic plan if the LLM fails.
    const plan = (await fetchAssetPlan(state)) ?? buildFallbackPlan(state);

    // 2. Apply the plan deterministically: walk entities, write SVGs, build manifest.
    const entries: AssetEntry[] = [];
    const planEntityById = new Map(plan.entities.map((p) => [p.id, p]));

    for (const entity of state.rules_dsl.entities) {
      const identity = entity.components.Identity;
      if (!identity || typeof identity !== 'object') continue;

      const { kind } = identity as { kind: string };

      let role: AssetEntry['role'] = 'misc';
      if (kind.includes('board') || kind.includes('track')) role = 'board';
      else if (kind.includes('card')) role = 'card_template';
      else if (kind.includes('token') || kind.includes('piece')) role = 'token';
      else if (kind.includes('tile')) role = 'tile';

      const planEntry = planEntityById.get(entity.id);
      const label = planEntry?.label ?? entity.id.substring(0, 3);
      const colorIdx = planEntry?.color_index ?? 0;
      const color = plan.palette[colorIdx % plan.palette.length] ?? plan.palette[0]!;

      let svg: string;
      switch (role) {
        case 'board':
          svg = makeBoardGrid(8, 8, plan.palette);
          break;
        case 'card_template':
          svg = makeCardTemplate(plan.palette);
          break;
        case 'token':
          svg = makePiece(label.substring(0, 3), color);
          break;
        default:
          svg = makePiece(label.substring(0, 1), color);
      }

      const filename = `${entity.id}.svg`;
      writeFileSync(join(assetDir, filename), svg);
      entries.push({
        id: entity.id,
        file: filename,
        role,
        svg_viewbox: extractViewbox(svg),
      });
    }

    const manifest: AssetManifest = { palette: plan.palette, entries };
    writeFileSync(
      join(config.BUNDLES_DIR, state.bundle_id, 'asset-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    return { status: 'assembling', asset_manifest: manifest };
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
 * Build an LLM prompt for the AssetPlan and return the parsed plan,
 * or null if all retry attempts fail.
 */
async function fetchAssetPlan(state: BuildState): Promise<AssetPlan | null> {
  if (!state.rules_dsl) return null;
  // Theme + glyph generation is creative — use a higher temperature so two
  // rebuilds of the same game produce visually distinct palettes/labels.
  // If we can't create the creative LLM (e.g. missing key in tests), fall back.
  let creativeLlm;
  try {
    creativeLlm = await makeLlm(
      state.llm_provider,
      state.llm_model,
      state.llm_api_key,
      0.7,
    );
  } catch (err) {
    logger.warn({ err: String(err) }, 'asset_agent: creative LLM unavailable, using fallback');
    return null;
  }
  const entityList = state.rules_dsl.entities
    .map((e) => {
      const identity = e.components.Identity as { kind?: string } | undefined;
      return `- ${e.id} (kind=${identity?.kind ?? 'unknown'})`;
    })
    .join('\n');

  const systemPrompt = `You are a visual designer for board games. Given a game's entities, produce a coherent visual theme.

Return a JSON object with:
- theme_name: a short descriptive theme name (e.g. "Forest Kingdom", "Neon Arcade").
- palette: 4-6 CSS colors. Use hex (e.g. "#3B82F6") or named CSS colors. Keep the palette harmonious.
- entities: one entry per game entity, each with:
    - id: the entity id (must match exactly).
    - label: a 1-8 character glyph or abbreviation to print on the SVG (e.g. "X", "O", "K" for King).
    - color_index: which color from the palette to use (0-based index).

Keep labels short and visually distinct. Match the theme.`;

  const userPrompt = `Game: ${state.rules_dsl.metadata.game_name}\n\nEntities:\n${entityList}`;

  const { value, attempts, error } = await llmJsonRetry({
    llm: creativeLlm,
    schema: AssetPlanSchema,
    schemaName: 'AssetPlan',
    systemPrompt,
    userPrompt,
    tag: 'asset_agent',
  });

  if (!value) {
    logger.warn({ attempts, error }, 'AssetPlan LLM generation failed; falling back to deterministic');
  }
  return value;
}

/**
 * Deterministic fallback when LLM produces no plan.
 * Uses a rotating palette and entity-id-derived labels.
 */
function buildFallbackPlan(state: BuildState): AssetPlan {
  const ids = state.rules_dsl?.entities.map((e) => e.id) ?? [];
  const palette = generatePalette();
  return {
    theme_name: 'Default',
    palette,
    entities: ids.map((id, i) => ({
      id,
      label: id.substring(0, 3),
      color_index: i % palette.length,
    })),
  };
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
