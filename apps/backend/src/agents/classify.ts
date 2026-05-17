/**
 * Classification agent: normalizes prompt and extracts game metadata.
 * Outputs prompt_type and normalized game name into state.metadata.
 * See doc 05 for orchestrator context.
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BuildState } from '@bgb/shared';
import { emitSseEvent } from '../sse.js';

/**
 * Classify the build request and normalize metadata.
 */
export async function classifyAgent(state: BuildState, _llm: BaseChatModel): Promise<Partial<BuildState>> {
  emitSseEvent(state.bundle_id, {
    type: 'update',
    status: 'classifying',
    node: 'classify',
    message: 'Normalizing game name and mode...',
  });

  // Simple heuristic: extract the first likely game name from the prompt.
  // In production, this could be a light LLM call.
  const lines = state.prompt.split('\n');
  let game_name = 'Untitled Game';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 2 && trimmed.length < 100) {
      game_name = trimmed;
      break;
    }
  }

  const metadata = {
    game_name,
    prompt_type: state.mode as string,
    mode: state.mode,
  };

  return {
    status: 'fetching',
  };
}
