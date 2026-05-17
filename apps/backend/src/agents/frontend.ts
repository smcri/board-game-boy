/**
 * Frontend agent: generates BoardConfig and writes per-bundle config files.
 * Mostly deterministic from rules_dsl; optional small LLM call for render hints.
 */
import { BaseChatModel } from '@langchain/core/language_model/chat_model';
import { BuildState, BoardConfig } from '@bgb/shared';
import { emitSseEvent } from '../sse.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Frontend agent: generates BoardConfig and writes config files.
 */
export async function frontendAgent(state: BuildState, _llm: BaseChatModel): Promise<Partial<BuildState>> {
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
    const boardNodes = state.rules_dsl.entities
      .filter((e) => {
        const boardNode = e.components.BoardNode;
        return boardNode && typeof boardNode === 'object';
      })
      .map((e) => ({
        id: e.id,
        coords: (e.components.BoardNode as { coords?: Record<string, unknown> })?.coords,
        neighbours: (e.components.Adjacency as { to?: string[] })?.to,
      }));

    // Determine board kind from entities
    let kind: BoardConfig['kind'] = 'graph';
    if (boardNodes.length > 0) {
      const firstBoardNode = state.rules_dsl.entities[0];
      const boardNodeComp = firstBoardNode.components.BoardNode as { kind?: string };
      kind = (boardNodeComp?.kind as BoardConfig['kind']) || 'graph';
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
