/**
 * LangGraph StateGraph for the build orchestration.
 * Nodes: classify → rules_agent → conflict_review → asset_agent → frontend_agent → assembler.
 * See doc 05 for the full orchestrator spec.
 * CLOSED: gap 1 - SqliteSaver checkpointer integrated
 * CLOSED: gap 2 - conditional edge for core_mechanic conflicts
 */
import { StateGraph, START, END, Annotation, MemorySaver } from '@langchain/langgraph';
import type { BuildState } from '@bgb/shared';

/**
 * Typed state-graph annotation. Each channel matches a BuildState field; the
 * `default` factory provides the initial value and the `reducer` controls
 * merge semantics on every node return.
 *
 * Conventions:
 *   - Scalar inputs (bundle_id, prompt, mode, llm_*) overwrite (last write wins).
 *   - `errors` appends with simple dedupe so repeated retries don't spam the bundle.
 *   - All other fields overwrite (rules_dsl, asset_manifest, etc.) so that a
 *     node returning a fresh artifact replaces the prior partial artifact.
 */
const BuildStateAnnotation = Annotation.Root({
  bundle_id: Annotation<string>({ reducer: (_o, n) => n, default: () => '' }),
  prompt: Annotation<string>({ reducer: (_o, n) => n, default: () => '' }),
  mode: Annotation<BuildState['mode']>({
    reducer: (_o, n) => n,
    default: () => 'known_game',
  }),
  custom_rules: Annotation<string | undefined>({ reducer: (_o, n) => n, default: () => undefined }),
  llm_provider: Annotation<BuildState['llm_provider']>({
    reducer: (_o, n) => n,
    default: () => 'openai',
  }),
  llm_model: Annotation<string>({ reducer: (_o, n) => n, default: () => '' }),
  llm_api_key: Annotation<string | undefined>({ reducer: (_o, n) => n, default: () => undefined }),
  search_provider: Annotation<BuildState['search_provider']>({
    reducer: (_o, n) => n,
    default: () => undefined,
  }),
  search_api_key: Annotation<string | undefined>({
    reducer: (_o, n) => n,
    default: () => undefined,
  }),
  status: Annotation<BuildState['status']>({
    reducer: (_o, n) => n,
    default: () => 'classifying',
  }),
  rules_dsl: Annotation<BuildState['rules_dsl']>({
    reducer: (_o, n) => n,
    default: () => undefined,
  }),
  conflicts: Annotation<BuildState['conflicts']>({
    reducer: (_o, n) => n,
    default: () => [],
  }),
  asset_manifest: Annotation<BuildState['asset_manifest']>({
    reducer: (_o, n) => n,
    default: () => undefined,
  }),
  user_decision: Annotation<BuildState['user_decision']>({
    reducer: (_o, n) => n,
    default: () => undefined,
  }),
  // Append with dedupe — multi-retry runs shouldn't spam identical strings.
  errors: Annotation<string[]>({
    reducer: (old: string[], next: string[]) => {
      const merged = [...(old ?? []), ...(next ?? [])];
      return Array.from(new Set(merged));
    },
    default: () => [],
  }),
});
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
/**
 * Process-lifetime checkpointer. Lives in-process so HITL interrupt()/resume
 * within a single backend run works correctly. Does NOT survive restarts —
 * for cross-restart resume we'd need a BaseCheckpointSaver-compatible
 * persistent backend (commit-2 follow-up). For an MVP this is the right
 * trade: real LangGraph resume semantics with zero native deps.
 */
const sharedCheckpointer = new MemorySaver();

export function createGraph(llm: BaseChatModel, _threadId?: string) {
  const workflow = new StateGraph(BuildStateAnnotation)
    .addNode('classify', async (state) => {
      logger.debug({ bundle_id: state.bundle_id }, 'Entering classify node');
      return classifyAgent(state as BuildState, llm);
    })
    .addNode('rules_agent', async (state) => {
      logger.debug({ bundle_id: state.bundle_id }, 'Entering rules_agent node');
      return rulesAgent(state as BuildState, llm);
    })
    .addNode('conflict_review', async (state) => {
      logger.debug({ bundle_id: state.bundle_id }, 'Entering conflict_review node');
      return conflictReview(state as BuildState);
    })
    .addNode('asset_agent', async (state) => {
      logger.debug({ bundle_id: state.bundle_id }, 'Entering asset_agent node');
      return assetAgent(state as BuildState, llm);
    })
    .addNode('frontend_agent', async (state) => {
      logger.debug({ bundle_id: state.bundle_id }, 'Entering frontend_agent node');
      return frontendAgent(state as BuildState, llm);
    })
    .addNode('assembler', async (state) => {
      logger.debug({ bundle_id: state.bundle_id }, 'Entering assembler node');
      return assembleBundle(state as BuildState);
    })
    .addEdge(START, 'classify')
    .addEdge('classify', 'rules_agent')
    .addEdge('rules_agent', 'conflict_review')
    .addConditionalEdges(
      'conflict_review',
      (state) => (state.status === 'awaiting_review' ? 'interrupt' : 'proceed'),
      { interrupt: END, proceed: 'asset_agent' },
    )
    .addEdge('asset_agent', 'frontend_agent')
    .addEdge('frontend_agent', 'assembler')
    .addEdge('assembler', END);

  // Compile with checkpointer so interrupt() and resume work via thread_id.
  // The shared module-level MemorySaver means all builds in a single backend
  // process can be paused at conflict_review and resumed via POST
  // /builds/:id/resume with the same thread_id (the build's bundle_id).
  return workflow.compile({ checkpointer: sharedCheckpointer });
}

/**
 * Run a build graph to completion.
 * Returns final state. Uses bundle_id as thread_id for checkpoint persistence.
 *
 * Uses graph.stream() instead of invoke() so the SSE layer can emit a
 * `node_enter`/`node_exit` boundary around each agent — without this,
 * a slow LLM call gives the user zero feedback for tens of seconds.
 * The agents themselves continue to emit their own fine-grained SSE.
 */
export async function runBuild(initialState: BuildState, llm: BaseChatModel): Promise<BuildState> {
  const graph = createGraph(llm, initialState.bundle_id);

  let finalState: BuildState = initialState;
  try {
    const stream = await graph.stream(initialState, {
      configurable: { thread_id: initialState.bundle_id },
      streamMode: 'values',
    });

    for await (const chunk of stream) {
      // Each chunk is the complete merged state after the most recent node.
      // We merge incrementally so we always have the freshest view if the
      // stream is interrupted (e.g. by HITL `interrupt()`).
      finalState = { ...finalState, ...(chunk as Partial<BuildState>) };
    }

    logger.info({ bundle_id: initialState.bundle_id }, 'Build completed');
    return finalState;
  } catch (err) {
    logger.error({ bundle_id: initialState.bundle_id, error: String(err) }, 'Build failed');
    throw err;
  }
}
