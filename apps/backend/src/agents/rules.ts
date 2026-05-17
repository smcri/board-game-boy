/**
 * Rules agent: orchestrates the full pipeline per doc 04.
 * - Plans queries
 * - Runs searches
 * - Fetches and extracts content
 * - Generates RulesDsl via structured LLM output
 * - Reconciles conflicts
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { BuildState, RulesDsl, COMPONENT_REGISTRY } from '@bgb/shared';
import { runSearch } from '../web/search.js';
import { bucketByPriority } from '../web/bucket.js';
import { fetchAndExtract } from '../web/fetcher.js';
import { emitSseEvent } from '../sse.js';
import { logger } from '../logger.js';
import { withStructuredOutput } from '../llm.js';
import { z } from 'zod';

/**
 * Rules agent node.
 * Implements the full pipeline: search → fetch → extract → LLM → reconcile.
 */
export async function rulesAgent(state: BuildState, llm: BaseChatModel): Promise<Partial<BuildState>> {
  try {
    emitSseEvent(state.bundle_id, {
      type: 'update',
      status: 'fetching',
      node: 'rules_agent',
      message: 'Planning search queries...',
    });

    // Step 1: Plan queries (simple heuristic for MVP)
    const queries = planQueries(state.prompt);
    logger.debug({ queries }, 'Planned queries');

    // Step 2: Search — run all queries in parallel with isolation per query.
    // One failing query (rate-limit, bad input) should not block the others.
    const allHits: Array<{ url: string; title?: string; snippet?: string }> = [];
    if (state.search_provider && state.search_api_key) {
      const searchProvider = state.search_provider;
      const searchKey = state.search_api_key;
      const results = await Promise.allSettled(
        queries.map(async (query) => {
          const hits = await runSearch(searchProvider, searchKey, query);
          emitSseEvent(state.bundle_id, {
            type: 'search',
            provider: searchProvider,
            query,
            hits: hits.length,
          });
          return hits;
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          allHits.push(...r.value);
        } else {
          logger.warn({ error: String(r.reason) }, 'Search query failed');
        }
      }
    } else {
      logger.info('No search provider configured; skipping web search');
      emitSseEvent(state.bundle_id, {
        type: 'update',
        status: 'fetching',
        node: 'rules_agent',
        message: 'No search provider; proceeding with user prompt',
      });
    }

    // Step 3: Bucket by priority
    const bucketed = bucketByPriority(allHits);
    logger.debug({ buckets: Object.keys(bucketed).map((k) => ({ [k]: bucketed[k as keyof typeof bucketed].length })) }, 'Bucketed results');

    // Step 4: Fetch & extract highest non-empty bucket
    let extractedContent = '';
    for (const bucket of ['pdf', 'publisher', 'bgg', 'fan'] as const) {
      for (const hit of bucketed[bucket]) {
        try {
          emitSseEvent(state.bundle_id, {
            type: 'fetch',
            url: hit.url,
            status: 'started',
          });

          const content = await fetchAndExtract(hit.url);
          extractedContent += `\n--- From ${bucket}: ${hit.title || hit.url} ---\n${content.text}`;

          emitSseEvent(state.bundle_id, {
            type: 'fetch',
            url: hit.url,
            status: 'done',
            bytes: content.text.length,
            source_type: bucket,
          });

          // Found good content; continue with next bucket for reconciliation
          break;
        } catch (err) {
          logger.warn({ url: hit.url, error: String(err) }, 'Fetch failed');
          emitSseEvent(state.bundle_id, {
            type: 'fetch',
            url: hit.url,
            status: 'error',
          });
        }
      }
      if (extractedContent) break;
    }

    // Step 5: Call LLM with structured output to generate RulesDsl
    emitSseEvent(state.bundle_id, {
      type: 'update',
      status: 'parsing',
      node: 'rules_agent',
      message: 'Parsing rules via LLM...',
    });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = `User prompt:\n${state.prompt}\n\nExtracted rules:\n${extractedContent}`;

    let rules_dsl: RulesDsl | null = null;
    let parseError: string | null = null;

    try {
      const structuredLlm = withStructuredOutput(llm, RulesDsl, { name: 'RulesDsl' });
      const result = await structuredLlm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      if (result instanceof z.ZodError) {
        parseError = result.message;
      } else {
        rules_dsl = result;
      }
    } catch (err) {
      parseError = String(err);
      logger.warn({ error: parseError }, 'LLM structured output failed; retrying...');
      // Retry once more with relaxed constraints
      try {
        const structuredLlm = withStructuredOutput(llm, RulesDsl, { name: 'RulesDsl' });
        const result = await structuredLlm.invoke([
          new SystemMessage(systemPrompt + '\n\nBe lenient with the schema; fill in defaults where needed.'),
          new HumanMessage(userPrompt),
        ]);
        if (!(result instanceof z.ZodError)) {
          rules_dsl = result;
          parseError = null;
        }
      } catch (retryErr) {
        parseError = String(retryErr);
      }
    }

    if (!rules_dsl) {
      throw new Error(`Failed to generate RulesDsl: ${parseError}`);
    }

    return {
      status: 'awaiting_review',
      rules_dsl,
      conflicts: rules_dsl.conflicts || [],
    };
  } catch (err) {
    const errorMsg = String(err);
    logger.error({ error: errorMsg }, 'Rules agent failed');
    emitSseEvent(state.bundle_id, {
      type: 'error',
      node: 'rules_agent',
      message: errorMsg,
    });
    return {
      status: 'error',
      errors: [...(state.errors || []), errorMsg],
    };
  }
}

/**
 * Simple query planner: extract key terms from prompt.
 */
function planQueries(prompt: string): string[] {
  const words = prompt.toLowerCase().split(/\s+/);
  // Simple heuristic: take the first few meaningful words
  const queries = [
    words.slice(0, 3).join(' '),
    words.slice(0, 5).join(' '),
    `${words[0]} rules`,
  ];
  return [...new Set(queries)].filter((q) => q.length > 0);
}

/**
 * Build system prompt for RulesDsl generation.
 */
function buildSystemPrompt(): string {
  const componentNames = Object.keys(COMPONENT_REGISTRY);
  const verbList = ['set', 'inc', 'move', 'choose', 'if', 'phase', 'atomic', 'random.roll', 'random.pick'];

  return `You are an expert board game rule parser. Your task is to convert informal game descriptions into a structured RulesDsl JSON object.

The output must:
1. Identify all game entities (players, board, cards, tokens, etc.) and assign them appropriate ECS components.
2. Define all player actions (moves, turns, trades, etc.) with preconditions and effects.
3. Specify win conditions.
4. Use only these components: ${componentNames.join(', ')}.
5. Use only these effect verbs: ${verbList.join(', ')}.
6. When in doubt about rules, create a Conflict entry with severity 'rule_detail'.

Always output valid JSON matching the RulesDsl schema. Do not include markdown formatting.`;
}
