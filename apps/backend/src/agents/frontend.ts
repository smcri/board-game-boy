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
import { makeLlm } from '../llm.js';
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
    const uiCopy = await fetchUiCopy(state, llm);
    if (!uiCopy) {
      throw new Error(
        'frontend_agent: LLM failed to produce valid UI copy after all retry attempts. ' +
        'Check your API key, model availability, and the rules_agent output.',
      );
    }
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
async function fetchUiCopy(state: BuildState, llm: BaseChatModel): Promise<UICopy | null> {
  if (!state.rules_dsl) return null;
  // UI copy (button labels, victory message) is creative — use a higher
  // temperature so two rebuilds produce different flavor text.
  // Use a higher-temperature LLM for creative work. If we can't build one
  // (e.g. missing key in tests), fall back to the standard LLM passed in.
  let creativeLlm: BaseChatModel;
  try {
    creativeLlm = await makeLlm(
      state.llm_provider,
      state.llm_model,
      state.llm_api_key,
      0.7,
    );
  } catch (err) {
    logger.warn({ err: String(err) }, 'frontend_agent: creative LLM unavailable, using standard LLM');
    creativeLlm = llm;
  }
  const actions = state.rules_dsl.actions
    .map((a) => `- ${a.id}${a.name ? ` (current name: "${a.name}")` : ''}`)
    .join('\n');

  const systemPrompt = `# ROLE: Senior Copywriter for Board Game UI

# OBJECTIVE:
Given a board game's name, summary, and list of action ids, produce engaging, concise UICopy JSON.
Your output will be rendered in the player-facing game interface — every field must be correct and non-empty.

# INPUT SPECIFICATION:
You will receive:
1. **Game Name**: The board game's name.
2. **Game Summary**: A one-line description of the game (may be empty).
3. **Action List**: Each action id and its current name (if known).

# TASK:
1. Write a \`tagline\`: one punchy sentence (≤ 160 chars) that captures the feel of the game.
2. For EVERY action id in the Action List, write a short \`action_labels\` entry (≤ 60 chars, player-friendly).
3. Write a \`victory_message\`: shown when a player wins. Use \`{player}\` as a placeholder for the winner's name. Keep it ≤ 160 chars.
4. Write a \`primary_button\` label: 1–3 words for the main action button (e.g. "Roll Dice", "Play Card", "Move").

# MANDATORY FIELD ANNOTATIONS:
- \`tagline\`: MANDATORY. 1–160 chars. MUST be thematically appropriate for the game. YOU MUST NOT leave this blank.
- \`action_labels\`: MANDATORY. MUST contain exactly one entry per action id in the input list. Keys MUST match action ids exactly. YOU MUST NOT omit any action id.
- \`victory_message\`: MANDATORY. 1–160 chars. MUST include \`{player}\` as a placeholder. YOU MUST NOT leave this blank.
- \`primary_button\`: MANDATORY. 1–30 chars. MUST be ≥1 word. Default: "Take action" if unsure.

# OUTPUT FORMAT (Strict Adherence Required):
1. Produce ONLY a single JSON object.
2. **ABSOLUTELY NO** introductory text, preamble, or commentary should precede the opening \`{\` or follow the closing \`}\`.
3. Do NOT wrap the JSON in markdown fences.`;

  const userPrompt = `# Game Name:
${state.rules_dsl.metadata.game_name}

# Game Summary:
${state.rules_dsl.metadata.summary ?? '(none provided)'}

# Action List:
${actions}

# REMINDER: Every action id above MUST have an entry in action_labels. Keys must match exactly. Output ONLY the JSON object.`;

  const { value, attempts, error } = await llmJsonRetry({
    llm: creativeLlm,
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
