/**
 * Rules agent: orchestrates the full pipeline per doc 04.
 * - Plans queries
 * - Runs searches
 * - Fetches and extracts content
 * - Generates RulesDsl via structured LLM output
 * - Reconciles conflicts
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BuildState, RulesDsl, COMPONENT_REGISTRY } from '@bgb/shared';
import { runSearch } from '../web/search.js';
import { bucketByPriority } from '../web/bucket.js';
import { fetchAndExtract } from '../web/fetcher.js';
import { emitSseEvent } from '../sse.js';
import { logger } from '../logger.js';
import { llmJsonRetry } from '../llm-retry.js';
import { EXAMPLE_RULES_DSL_JSON } from './rules-example.js';

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

    const { value: rules_dsl, attempts, error: parseError } = await llmJsonRetry({
      llm,
      schema: RulesDsl,
      schemaName: 'RulesDsl',
      systemPrompt,
      userPrompt,
      tag: 'rules_agent',
    });

    if (!rules_dsl) {
      throw new Error(`Failed to generate RulesDsl after ${attempts} attempts: ${parseError}`);
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

  return `You are an expert board game rule parser.

## YOUR JOB
The user will name a specific board game. You must produce a RulesDsl JSON object that describes
the rules of THAT game. Do not describe Snakes & Ladders or any other example game — produce
rules for the game the user actually requested.

## OUTPUT SCHEMA (every field is required unless marked optional)

{
  "dsl_version": "1.0",                          // EXACTLY the string "1.0"
  "metadata": {                                  // object, required
    "game_name": "string",                       // REQUIRED — name of the user's game
    "summary": "optional one-line description",  // OPTIONAL
    "min_players": 1,                            // REQUIRED positive int
    "max_players": 4                             // REQUIRED positive int
  },
  "entities": [                                  // array of objects with id + components
    {
      "id": "unique_string_id",                  // REQUIRED string
      "components": {                            // OBJECT (NOT array) - keys are component names
        "Identity": { "name": "My entity", "kind": "board" }  // Identity ALWAYS needs BOTH name + kind
      }
    }
  ],
  "actions": [
    {
      "id": "unique_action_id",                  // REQUIRED string
      "name": "Human-readable action name",
      "preconditions": [                         // array of Condition objects — use "op" not "kind"
        { "op": "eq", "path": "some.path", "value": "expected_value" }
      ],
      "effect": [                                // REQUIRED array of Effect objects — use "verb" not "op"
        { "verb": "set", "entity": "entity_id", "component": "Counter", "field": "value", "value": 1 }
      ]
    }
  ],
  "win_conditions": [
    {
      "id": "win1",                              // REQUIRED string
      "description": "Three in a row",           // REQUIRED string
      "when": { "kind": "expression", "expr": "..." }  // REQUIRED object
    }
  ],
  "conflicts": [                                 // array; can be empty []
    {
      "id": "c1",                                // REQUIRED string
      "rule": "Description of the ambiguous rule",
      "sources": ["url or source label"],
      "confidence": 0.6,                         // number 0..1
      "severity": "rule_detail"
    }
  ]
}

## ALLOWED COMPONENTS (use exactly these names as keys in entity.components):
${componentNames.join(', ')}

## ALLOWED EFFECT VERBS (use only these as "op" values):
${verbList.join(', ')}

## RULES
- Output STRICT JSON only. No markdown fences, no commentary.
- Every entity MUST have a string \`id\` and an OBJECT (not array) \`components\`.
- Every action MUST have a string \`id\` and an ARRAY \`effect\` of operation objects.
- Every win_condition MUST have \`id\`, \`description\`, AND \`when\` (an object).
- Every conflict (if any) MUST have \`id\`, \`rule\`, \`sources\` (array), and \`confidence\` (number).
- If you are unsure about a specific rule, ADD it to \`conflicts\` rather than inventing.

## CONCRETE EXAMPLE (Snakes & Ladders — study the SHAPE, not the content)

IMPORTANT: The JSON below is ONE specific game. Your output must describe the
game the user requested, not Snakes & Ladders. Use the same field names, the
same discriminator keys (e.g. "op", "verb"), the same component names — but
fill them with entities, actions, and win conditions for the requested game.

Common mistakes to avoid:
  ❌ Identity: { "kind": "board" }          — Identity requires BOTH "name" AND "kind"
  ✅ Identity: { "name": "Main board", "kind": "board" }

  ❌ precondition: { "kind": "phase_is", "phase": "main" }   — wrong field; use "op"
  ✅ precondition: { "op": "eq", "path": "...", "value": ... }

  ❌ effect: { "op": "set", "path": "...", "value": ... }   — effects use "verb" not "op"
  ✅ effect: { "verb": "set", "entity": "...", "component": "...", "field": "...", "value": ... }

  ❌ sources: ["some url string"]            — sources must be objects, not strings
  ✅ sources: [{ "url": "https://...", "source_type": "fan" }]

  ❌ conflicts without "description"        — "description" is required
  ✅ conflicts with "id", "rule", "description", "sources", "severity", "confidence"

${EXAMPLE_RULES_DSL_JSON}`;
}
