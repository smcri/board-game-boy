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
    const userPrompt = buildUserPrompt(state.prompt, extractedContent);

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
 * Uses the same prompt-engineering conventions as the internal SEA threat-model
 * system: ROLE → OBJECTIVE → INPUT SPECIFICATION → TASK (numbered) → CONFLICT
 * ADDITION RUBRIC → FIELD-LEVEL MANDATORY ANNOTATIONS → ANTI-EXAMPLES →
 * OUTPUT FORMAT → CONCRETE EXAMPLE.
 */
function buildSystemPrompt(): string {
  const componentNames = Object.keys(COMPONENT_REGISTRY);
  const conditionOps = ['eq', 'neq', 'gte', 'lte', 'in', 'not_in', 'and', 'or', 'not', 'count_at_least', 'component_present', 'path_equals'];
  const verbList = ['set', 'inc', 'move', 'choose', 'if', 'phase', 'atomic', 'random.roll', 'random.pick'];

  return `# ROLE: Expert Board Game Rule Parser and DSL Engineer

# OBJECTIVE:
Convert the user's board game name and any extracted rules text into a complete, valid RulesDsl JSON object.
Your output will be used directly by a deterministic game engine — every field must be correct.
You MUST describe the game the user requested, NOT the example game shown below.

# INPUT SPECIFICATION:
You will receive two inputs in the user message:
1. **Game Name / Prompt**: The specific board game the user wants to build.
2. **Extracted Rules Text**: Raw text extracted from web sources about that game's rules (may be empty or partial).

# TASK:
1. Identify the game the user requested from the "Game Name / Prompt" field.
2. Use your knowledge of that game PLUS any relevant detail from "Extracted Rules Text" to populate the RulesDsl.
3. Model the game's entities (board, players, tokens, dice, cards, etc.) as ECS entities with components from the ALLOWED COMPONENTS list.
4. Model each distinct player action as an ActionDecl with correct preconditions (using "op" discriminator) and effects (using "verb" discriminator).
5. Model each win condition as a WinConditionSchema entry with a valid Condition in the "when" field.
6. For any rule you are uncertain about, YOU MUST add a Conflict entry rather than inventing a resolution. See the CONFLICT ADDITION RUBRIC below.
7. Produce ONLY a single valid JSON object. **ABSOLUTELY NO** introductory text, markdown fences, or commentary should precede the opening \`{\` or follow the closing \`}\`.

# CONFLICT ADDITION RUBRIC:
Add a conflict entry when ANY of the following is true:
- **"rule_detail"** severity: The rule exists but has multiple common variants (e.g. exact-landing vs. reach-or-pass, stacking rules in card games).
- **"core_mechanic"** severity: Two or more sources contradict each other on a fundamental mechanic (e.g. whether a die roll is shared or individual).
- **"flavor"** severity: The rule is cosmetic / optional / house-rule level.
- **"unsupported_effect"** severity: The rule requires an effect verb not in the ALLOWED EFFECT VERBS list.
Do NOT add a conflict if the rule is universally agreed-upon (e.g. "Chess uses an 8×8 board").

# ALLOWED COMPONENTS (use EXACTLY these strings as keys in entity.components):
${componentNames.join(', ')}

# ALLOWED CONDITION OPS (use EXACTLY one of these as the "op" discriminator in preconditions and win_condition.when):
${conditionOps.join(', ')}

# ALLOWED EFFECT VERBS (use EXACTLY one of these as the "verb" discriminator in action.effect):
${verbList.join(', ')}

# MANDATORY FIELD ANNOTATIONS:
Every field marked MANDATORY below MUST be present and non-empty in your output. Do NOT omit any.

- \`dsl_version\`: MANDATORY. MUST be exactly the string "1.0".
- \`metadata.game_name\`: MANDATORY. MUST be the name of the game the user requested, not "Snakes and Ladders" or any example game.
- \`metadata.min_players\` / \`max_players\`: MANDATORY. MUST be positive integers.
- \`entities\`: MANDATORY. MUST contain at least 1 entity. Each entity MUST have a string \`id\` and an OBJECT \`components\` (NOT an array).
- \`entities[*].components.Identity\`: MANDATORY on every entity. MUST include BOTH \`name\` (string) AND \`kind\` (string). **YOU MUST NOT omit \`name\`.**
- **BoardNode topology**: Generate ONE board entity with BoardNode component describing the topology + size:
  - grid games (Chess, Checkers): \`BoardNode: { kind: "grid_square", cols: 8, rows: 8 }\`
  - track games (Snakes & Ladders): \`BoardNode: { kind: "track", spaces: 100 }\`
  - hex games: \`BoardNode: { kind: "grid_hex", radius: 5 }\`
  - **DO NOT** generate individual \`sq_0_0\` or \`square_N\` node entities — the assembler expands the topology automatically.
  - Token \`Position.node\` should reference the node id the assembler will generate (e.g. \`"sq_0_0"\` for grid, \`"square_0"\` for track).
- \`actions\`: MANDATORY. MUST contain at least 1 action. Each action MUST have \`id\` (string) and \`effect\` (array with ≥1 items).
- **PRIMARY MOVEMENT ACTION**: The main action that moves a piece/token on the board MUST have \`id: "move"\`. Other actions can have any id. This is required so the game engine can wire up click-to-move interaction.
- \`actions[*].preconditions[*].op\`: MANDATORY discriminator. MUST be one of the ALLOWED CONDITION OPS. **Do NOT use "kind" as the field name.**
- \`actions[*].effect[*].verb\`: MANDATORY discriminator. MUST be one of the ALLOWED EFFECT VERBS. **Do NOT use "op" as the field name for effects.**
- \`win_conditions\`: MANDATORY. MUST contain at least 1 entry. Each MUST have \`id\`, \`description\`, and \`when\` (a Condition object with an \`op\` discriminator).
- \`conflicts\`: MANDATORY array (can be empty \`[]\` only if there are genuinely zero ambiguous rules). Each conflict MUST have \`id\`, \`rule\`, \`description\`, \`sources\` (array of objects with \`url\` and \`source_type\`), \`severity\`, and \`confidence\` (number 0–1).

# COMMON MISTAKES — AVOID THESE:
  ❌ Identity: { "kind": "board" }
     — Identity requires BOTH "name" AND "kind". YOU MUST NOT omit "name".
  ✅ Identity: { "name": "Main board", "kind": "board" }

  ❌ precondition: { "kind": "phase_is", "phase": "main" }
     — Conditions use "op" as the discriminator, NOT "kind".
  ✅ precondition: { "op": "eq", "path": "some.path", "value": "expected" }

  ❌ effect: { "op": "set", "path": "...", "value": 1 }
     — Effects use "verb" as the discriminator, NOT "op".
  ✅ effect: { "verb": "set", "entity": "entity_id", "component": "Counter", "field": "value", "value": 1 }

  ❌ sources: ["https://example.com"]
     — Sources MUST be objects, not plain strings.
  ✅ sources: [{ "url": "https://example.com", "source_type": "fan" }]

  ❌ conflicts entry missing "description"
     — "description" is MANDATORY on every conflict entry.
  ✅ conflicts entry with "id", "rule", "description", "sources", "severity", "confidence"

# OUTPUT FORMAT (Strict Adherence Required):
1. Produce ONLY a single JSON object — the RulesDsl.
2. **ABSOLUTELY NO** introductory text, preamble, reasoning, or explanation should precede the opening \`{\` or follow the closing \`}\`.
3. Do NOT wrap the JSON in markdown fences (\`\`\`json ... \`\`\`).
4. Populate EVERY MANDATORY field. If a field is unknown, make a best-effort attempt and add a conflict entry to flag the uncertainty.

# CONCRETE EXAMPLE (Snakes & Ladders — study the SHAPE, not the game content)
CRITICAL: Your output MUST describe the game the user requested, NOT Snakes & Ladders.
Use the same field names, the same "op"/"verb" discriminator keys, the same component names —
but fill them with entities, actions, and rules for the user's game.

${EXAMPLE_RULES_DSL_JSON}`;
}

/**
 * Build user prompt for RulesDsl generation.
 */
function buildUserPrompt(prompt: string, extractedContent: string): string {
  return `# Game Name / Prompt:
${prompt}

# Extracted Rules Text:
${extractedContent || '(No rules text was extracted from web sources. Use your knowledge of this game to populate the RulesDsl accurately.)'}

# REMINDER:
- Produce a RulesDsl for the game named above, NOT for Snakes & Ladders or any other example.
- Use ONLY component names from the ALLOWED COMPONENTS list.
- Use ONLY "op" values from the ALLOWED CONDITION OPS list for preconditions and win_condition.when.
- Use ONLY "verb" values from the ALLOWED EFFECT VERBS list for action effects.
- Every entity MUST have Identity with BOTH "name" and "kind".
- Output ONLY the JSON object. No text before or after.`;
}
