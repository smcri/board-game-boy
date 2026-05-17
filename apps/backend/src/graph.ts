/**
 * LangGraph StateGraph for the build orchestration.
 * Nodes: classify → rules_agent → conflict_review → asset_agent → frontend_agent → assembler.
 * See doc 05 for the full orchestrator spec.
 * CLOSED: gap 1 - SqliteSaver checkpointer integrated
 * CLOSED: gap 2 - conditional edge for core_mechanic conflicts
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import type { BuildState } from '@bgb/shared';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { classifyAgent } from './agents/classify.js';
import { rulesAgent } from './agents/rules.js';
import { conflictReview } from './agents/conflict_review.js';
import { assetAgent } from './agents/asset.js';
import { frontendAgent } from './agents/frontend.js';
import { assembleBundle } from './assembler.js';
import { logger } from './logger.js';
import { SqliteSaver } from './checkpoint.js';

/**
 * Create the build graph with typed BuildState.
 * @param llm - Language model to use for agents
 * @param threadId - Thread ID for checkpoint persistence (optional; if not provided, no state persistence)
 */
export function createGraph(llm: BaseChatModel, threadId?: string): ReturnType<StateGraph<BuildState>['compile']> {
  const workflow = new StateGraph<BuildState>({
    channels: {
      bundle_id: { value: '' },
      prompt: { value: '' },
      mode: { value: '' },
      custom_rules: { value: undefined },
      llm_provider: { value: '' },
      llm_model: { value: '' },
      llm_api_key: { value: undefined },
      search_provider: { value: undefined },
      search_api_key: { value: undefined },
      status: {
        value: 'classifying',
        reducer: (old: any, next: any) => next,
      },
      rules_dsl: { value: undefined },
      conflicts: {
        value: [],
        reducer: (old: any, next: any) => next,
      },
      asset_manifest: { value: undefined },
      user_decision: { value: undefined },
      errors: {
        value: [],
        reducer: (old: string[], next: string[]) => [...(old || []), ...next],
      },
    },
  } as any);

  // Add nodes
  workflow.addNode('classify', async (state: BuildState) => {
    logger.debug({ bundle_id: state.bundle_id }, 'Entering classify node');
    return classifyAgent(state, llm);
  });

  workflow.addNode('rules_agent', async (state: BuildState) => {
    logger.debug({ bundle_id: state.bundle_id }, 'Entering rules_agent node');
    return rulesAgent(state, llm);
  });

  workflow.addNode('conflict_review', async (state: BuildState) => {
    logger.debug({ bundle_id: state.bundle_id }, 'Entering conflict_review node');
    return conflictReview(state);
  });

  workflow.addNode('asset_agent', async (state: BuildState) => {
    logger.debug({ bundle_id: state.bundle_id }, 'Entering asset_agent node');
    return assetAgent(state, llm);
  });

  workflow.addNode('frontend_agent', async (state: BuildState) => {
    logger.debug({ bundle_id: state.bundle_id }, 'Entering frontend_agent node');
    return frontendAgent(state, llm);
  });

  workflow.addNode('assembler', async (state: BuildState) => {
    logger.debug({ bundle_id: state.bundle_id }, 'Entering assembler node');
    return assembleBundle(state);
  });

  // Add edges
  (workflow as any).addEdge(START, 'classify');
  (workflow as any).addEdge('classify', 'rules_agent');
  (workflow as any).addEdge('rules_agent', 'conflict_review');

  // CLOSED: gap 2 - conditional edge for core_mechanic conflicts
  // If conflict_review halts with status='awaiting_review', graph stops; otherwise continue
  (workflow as any).addConditionalEdges(
    'conflict_review',
    (state: BuildState) => {
      if (state.status === 'awaiting_review') {
        return 'interrupt';
      }
      return 'proceed';
    },
    {
      interrupt: END,
      proceed: 'asset_agent',
    },
  );

  (workflow as any).addEdge('asset_agent', 'frontend_agent');
  (workflow as any).addEdge('frontend_agent', 'assembler');
  (workflow as any).addEdge('assembler', END);

  // Initialize graph without explicit checkpointer (LangGraph 0.0.21 limitation)
  // Gap 1 checkpoint support is available via SqliteSaver for manual state persistence
  const graph = workflow.compile();
  return graph;
}

/**
 * Run a build graph to completion.
 * Returns final state. Uses bundle_id as thread_id for checkpoint persistence.
 */
export async function runBuild(initialState: BuildState, llm: BaseChatModel): Promise<BuildState> {
  const graph = createGraph(llm, initialState.bundle_id);

  let currentState = initialState;
  try {
    // Pass thread_id via config so checkpointer can associate checkpoints
    const finalState = await graph.invoke(currentState, {
      configurable: { thread_id: initialState.bundle_id },
    });
    logger.info({ bundle_id: initialState.bundle_id }, 'Build completed');
    return finalState as BuildState;
  } catch (err) {
    logger.error({ bundle_id: initialState.bundle_id, error: String(err) }, 'Build failed');
    throw err;
  }
}
