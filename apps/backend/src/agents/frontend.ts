/**
 * Frontend agent: generates BoardConfig (deterministic) and UICopy (LLM-driven).
 *
 * BoardConfig is structural — derived directly from rules_dsl entities — so it
 * stays deterministic. UICopy (action labels, button text, victory message) is
 * creative work, so we ask the LLM for it and fall back to deterministic
 * id-based labels if the LLM call fails. The scaffold's game.js reads both
 * files at runtime.
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BuildState, BoardConfig } from '@bgb/shared';
import { emitSseEvent } from '../sse.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { llmJsonRetry } from '../llm-retry.js';
import { z } from 'zod';

const UICopySchema = z.object({
  /** A short tagline shown under the game title (1 sentence). */
  tagline: z.string().min(1).max(160),
  /** Human-readable label for each action id. */
  action_labels: z.record(z.string().min(1), z.string().min(1).max(60)),
  /** Message shown when a player wins. May include {player} placeholder. */
  victory_message: z.string().min(1).max(160),
  /** Text for the primary "act" button on the action panel. */
  primary_button: z.string().min(1).max(30).default('Take action'),
});
type UICopy = z.infer<typeof UICopySchema>;

/**
 * Frontend agent: generates BoardConfig and writes config files.
 */
export async function frontendAgent(state: BuildState, llm: BaseChatModel): Promise<Partial<BuildState>> {
  // Defence in depth: if the graph reached this node despite a HITL halt, pass through.
  if (state.status === 'awaiting_review') {
    return { status: 'awaiting_review' };
  }
  try {
    if (!state.rules_dsl) {
      throw new Error('No RulesDsl available for frontend generation');
    }

    emitSseEvent(state.bundle_id, {
      type: 'update',
      status: 'assembling',
      node: 'frontend_agent',
      message: 'Generating frontend config...',
    });

    // Generate BoardConfig from rules_dsl entities
    const boardNodes: BoardConfig['nodes'] = state.rules_dsl.entities
      .filter((e) => {
        const boardNode = e.components.BoardNode;
        return boardNode && typeof boardNode === 'object';
      })
      .map((e) => {
        const boardNodeComp = e.components.BoardNode as { coords?: Record<string, string | number> };
        const adjacencyComp = e.components.Adjacency as { to?: string[] };
        return {
          id: e.id,
          coords: boardNodeComp?.coords,
          neighbours: adjacencyComp?.to,
        };
      });

    // Determine board kind from entities
    let kind: BoardConfig['kind'] = 'graph';
    if (state.rules_dsl.entities.length > 0) {
      const firstBoardNode = state.rules_dsl.entities[0];
      if (firstBoardNode) {
        const boardNodeComp = firstBoardNode.components.BoardNode as { kind?: string };
        kind = (boardNodeComp?.kind as BoardConfig['kind']) || 'graph';
      }
    }

    const boardConfig: BoardConfig = {
      kind,
      nodes: boardNodes,
      regions: [],
      render_hints: {
        scale: 1,
        offset_x: 0,
        offset_y: 0,
      },
    };

    // Write board-config.json to scratch directory
    const scratchDir = join(config.BUNDLES_DIR, state.bundle_id, '.scratch');
    mkdirSync(scratchDir, { recursive: true });

    const boardConfigPath = join(scratchDir, 'board-config.json');
    writeFileSync(boardConfigPath, JSON.stringify(boardConfig, null, 2));

    // Also mirror asset-manifest.json to scratch
    if (state.asset_manifest) {
      const manifestPath = join(scratchDir, 'asset-manifest.json');
      writeFileSync(manifestPath, JSON.stringify(state.asset_manifest, null, 2));
    }

    // LLM-driven UI copy (player-facing labels, tagline, victory message).
    // Always falls back to deterministic copy if the LLM call fails.
    const uiCopy = (await fetchUiCopy(llm, state)) ?? buildFallbackUiCopy(state);
    writeFileSync(join(scratchDir, 'ui-copy.json'), JSON.stringify(uiCopy, null, 2));

    return {
      status: 'assembling',
    };
  } catch (err) {
    const errorMsg = String(err);
    logger.error({ error: errorMsg }, 'Frontend agent failed');
    emitSseEvent(state.bundle_id, {
      type: 'error',
      node: 'frontend_agent',
      message: errorMsg,
    });
    return {
      status: 'error',
      errors: [...(state.errors || []), errorMsg],
    };
  }
}

/**
 * Ask the LLM for UI copy. Returns null if all retry attempts fail.
 */
async function fetchUiCopy(llm: BaseChatModel, state: BuildState): Promise<UICopy | null> {
  if (!state.rules_dsl) return null;
  const actions = state.rules_dsl.actions
    .map((a) => `- ${a.id}${a.name ? ` (current name: "${a.name}")` : ''}`)
    .join('\n');

  const systemPrompt = `You are a copywriter for board games. Given a game's name and its actions, produce UI copy.

Return a JSON object with:
- tagline: a single-sentence tagline shown under the title.
- action_labels: a map from action id to a short human-readable label (max 60 chars).
- victory_message: shown when a player wins. May include "{player}" as a placeholder for the winner's name.
- primary_button: a 1-3 word label for the action button (default: "Take action").

Keep copy lively but concise. Every action id in the list must have a label.`;

  const userPrompt = `Game: ${state.rules_dsl.metadata.game_name}\n${state.rules_dsl.metadata.summary ?? ''}\n\nActions:\n${actions}`;

  const { value, attempts, error } = await llmJsonRetry({
    llm,
    schema: UICopySchema,
    schemaName: 'UICopy',
    systemPrompt,
    userPrompt,
    tag: 'frontend_agent',
  });
  if (!value) {
    logger.warn({ attempts, error }, 'UICopy LLM generation failed; falling back to deterministic');
  }
  return value;
}

/**
 * Deterministic fallback when LLM call fails.
 */
function buildFallbackUiCopy(state: BuildState): UICopy {
  const action_labels: Record<string, string> = {};
  for (const a of state.rules_dsl?.actions ?? []) {
    action_labels[a.id] = a.name ?? a.id.replace(/_/g, ' ');
  }
  return {
    tagline: state.rules_dsl?.metadata.summary ?? 'A board game generated by Board Game Builder.',
    action_labels,
    victory_message: '{player} wins!',
    primary_button: 'Take action',
  };
}
