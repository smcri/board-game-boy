# 05 — Orchestrator & Human-in-the-Loop (HITL)

## Purpose & scope

This document specifies the build orchestration layer and human-in-the-loop (HITL) system for the Agentic Board Game Builder MVP. It covers:

- **Orchestration engine**: LangGraph.js StateGraph with typed BuildState, 6-node DAG, checkpoint durability.
- **HITL integration**: interrupt/resume mechanics triggered only on core_mechanic conflicts.
- **API surface**: Fastify endpoints for build lifecycle (POST, GET, resume, stream).
- **State management**: Zod-validated BuildState, per-request API key injection, runtime LLM provider selection.
- **Durability & restart**: SQLite checkpointer, thread_id ≡ bundle_id, automatic recovery on backend restart.
- **Observability**: Structured pino logging with scrubbed secrets, SSE progress events as user-facing telemetry.

The scope is the *MVP build flow only*: from user prompt to assembled bundle. Multi-tenant auth, HITL beyond conflict review, and advanced concurrency tuning are deferred.

---

## Locked decisions

### 1. Orchestrator: LangGraph.js StateGraph

**Decision**: Use LangGraph.js (`@langchain/langgraph`) for graph definition, state management, and checkpointing.

**State shape** (Zod-validated BuildState):
```typescript
const BuildState = z.object({
  bundle_id: z.string().uuid(),
  prompt: z.string(),
  mode: z.enum(['sketch', 'analyze', 'build']),
  custom_rules: z.array(z.string()).optional(),
  
  llm_provider: z.enum(['openai', 'anthropic', 'ollama', 'groq']),
  llm_model: z.string(),
  llm_api_key: z.string().optional(), // Held in state only; never persisted
  
  search_provider: z.enum(['tavily', 'serper']).optional(),
  search_api_key: z.string().optional(),
  
  prompt_type: z.enum(['game_rules', 'ui', 'mechanics']).optional(),
  rules_dsl: z.any().optional(), // RulesDSL (cf. doc 03)
  conflicts: z.array(Conflict).optional(),
  asset_manifest: z.any().optional(),
  bundle_path: z.string().optional(),
  
  user_decision: z.record(z.enum(['accept', 'override']).or(z.any())).optional(),
  errors: z.array(z.object({ node: z.string(), message: z.string() })).optional(),
});
```

**Why**: Covers orchestration (graph + state machine), interrupt/resume for HITL, native checkpointer, and Annotation API for schema validation—all in one library. No need to bolt on a separate durability layer.

### 2. Node pipeline (in order)

1. **classify**: Infer prompt_type (game_rules | ui | mechanics) from user prompt.
2. **rules_agent**: Generate RulesDSL, search/fetch rules if needed, surface conflicts (cf. doc 04).
3. **conflict_review**: Evaluate conflicts; interrupt if any conflict.severity === 'core_mechanic' (see §3).
4. **asset_agent**: Generate asset manifest and placeholder URLs.
5. **frontend_agent**: Generate game.js wrapper code.
6. **assemble_bundle**: Write bundle.json, assets, game.js to disk; emit done.

Edges are sequential (classify → rules_agent → conflict_review → …) with one conditional:
- **conflict_review**: If core_mechanic conflicts exist, call `interrupt()`; otherwise pass through.

### 3. HITL: interrupt() at conflict_review; resume via Command({ resume: … })

**Trigger**: HITL fires *only* when any conflict has `severity === 'core_mechanic'`.

**Why this distinction**:
- **Core mechanic conflicts** (win condition, turn structure, end trigger, action resolution) block build semantics. User judgment is required and actionable: accept the conflict, override with a fallback, or modify the rule.
- **Non-core conflicts** (unsupported effects, missing clarifications) are capability gaps, not design disputes. Surfaced in the bundle summary for post-build review, not in HITL.

**Flow**:
1. **conflict_review node** evaluates `conflicts` array.
2. If any `conflict.severity === 'core_mechanic'`:
   - Call `interrupt({ conflicts: [core_mechanic_conflicts] })`.
   - Graph pauses; state is checkpointed.
   - SSE event `interrupt` sent to client (see §5).
3. **Backend awaits resume**: Client POSTs `/builds/:id/resume { decision }`.
4. **Resume merges decision** into `user_decision` field; graph resumes from checkpoint.
5. **rules_agent (or a post-resume step) applies decision**: e.g., accept conflict as-is, override with fallback rule, or modify original rule.

**Resume payload shape**:
```typescript
{
  decision: {
    [conflict_id]: 'accept' | 'override' | { value: any, rule_override: string }
  }
}
```

Non-core conflicts pass through silently and appear in the final bundle summary.

### 4. Durability: SqliteSaver checkpointer

**Decision**: Use LangGraph's `SqliteSaver` with database at `${DATA_DIR}/bgb.sqlite`.

**Thread ID ≡ Bundle ID**: Each build has a unique `bundle_id` (UUID); this is also the `thread_id` passed to the graph. All checkpoints are keyed by this ID.

**Recovery on restart**:
- Process crashes during a build.
- On backend restart, outstanding bundle_ids are not automatically resumed.
- Client reconnects to `GET /builds/:id/stream`; if the build is still in progress (has a checkpoint), graph resumes from the last checkpoint.
- If client posts `/resume` before reconnecting, resume is queued and applied on next stream attach.

**Why SQLite for MVP**: Zero infrastructure, persistent /data directory on HF Spaces, easy local development, straightforward migration to Postgres if multi-user or high concurrency is needed later.

### 5. Per-request API keys: never persisted, scrubbed from logs

**Client-side key storage**:
- User enters LLM API key, Search API key in the UI.
- Keys are stored in `localStorage` with mitigations: strict CSP, 'Forget keys' button, no third-party scripts.
- Keys transmitted in POST /builds request headers: `X-LLM-API-Key`, `X-SEARCH-API-Key`.

**Backend handling**:
- Extract headers into `llm_api_key` and `search_api_key` in BuildState.
- Keys are **never written to disk, never logged in full**.
- Held in memory for the duration of the graph run.
- On process exit or build completion, keys are garbage-collected.

**Logging & error scrubbing**:
- Redact any key starting with `sk-` or matching `*_api_key` pattern in logs.
- Error responses to client never include `X-*` headers or API keys.
- Error messages capture the error type and context, not the key itself.

### 6. LLM abstraction: initChatModel at runtime

**Decision**: Use LangChain's `initChatModel()` (Annotation API).

**Provider & model selection**: Stored in state as `llm_provider` and `llm_model`. At runtime, the rules_agent, asset_agent, and frontend_agent call `initChatModel({ model: state.llm_model })` to instantiate the correct LLM, binding the API key from state.

**Supported**: OpenAI, Anthropic, Ollama, Groq (and any other LangChain-supported provider).

### 7. Backend HTTP surface: Fastify + SSE streaming

| Endpoint | Method | Request | Response | Purpose |
|----------|--------|---------|----------|---------|
| `/builds` | POST | `{ prompt, mode, custom_rules?, llm_provider, llm_model, search_provider? }` (headers: `X-LLM-API-Key`, `X-SEARCH-API-Key`) | `{ bundle_id, stream_url }` | Initiate build; return UUID and stream URL. |
| `/builds/:id/stream` | GET | — | SSE stream (text/event-stream) | Attach to running build; receive updates, interrupt, done, or error events. |
| `/builds/:id/resume` | POST | `{ decision: { [conflict_id]: … } }` | `{ ok: boolean }` | Resume build after HITL interrupt. |
| `/bundles/:id` | GET | — | `{ bundle_id, prompt, mode, rules_dsl, conflicts: […], asset_manifest, created_at, status }` | Metadata for a completed build. |
| `/bundles/:id/game.js` | GET | — | JavaScript source | Assembled frontend wrapper. |
| `/bundles/:id/assets/*` | GET | — | Binary (PNG/MP3/etc.) | Asset file (image, audio, etc.). |
| `/healthz` | GET | — | `{ ok: boolean, uptime, sqlite_ok: boolean }` | Health check; verify DB and checkpointer. |

**CORS**: Allow-list = Pages origin (configured) + localhost (dev). Credentials included.

### 8. SSE event types

Emitted from graph nodes; client receives as `MessageEvent`:

```typescript
// Emitted by each node on progress
{
  event: 'update',
  data: JSON.stringify({
    node: 'rules_agent' | 'asset_agent' | …,
    status: 'running' | 'cached' | 'skipped',
    message: string,
    partial_state: { … } // snapshot of BuildState
  })
}

// Emitted by conflict_review on core_mechanic conflict
{
  event: 'interrupt',
  data: JSON.stringify({
    conflicts: [ { id, description, severity, … } ],
    prompt_to_user: string // e.g., "Fog of war conflicts win condition. Accept or override?"
  })
}

// Emitted by assemble_bundle on success
{
  event: 'done',
  data: JSON.stringify({
    bundle_id, bundle_path, summary: { … }
  })
}

// Emitted on error (any node)
{
  event: 'error',
  data: JSON.stringify({
    node: string,
    message: string, // scrubbed; no keys or sensitive data
    code: string
  })
}
```

### 9. Logging: structured pino with scrubbed secrets

**Schema**: Each log entry includes:
```typescript
{
  timestamp: ISO8601,
  level: 'debug' | 'info' | 'warn' | 'error',
  node: string, // which graph node
  event: string, // e.g., 'state_checkpoint', 'llm_invoke', 'conflict_detected'
  bundle_id: string,
  message: string,
  context: { … } // error details, metrics, etc. — keys redacted
}
```

**Scrubbing rules**:
- Pattern `sk-*`: redact entirely.
- Pattern `*_api_key`, `*_token`: redact value, log key name only.
- Full request/response bodies containing keys: log only type and size.

---

## Trade-offs considered

### 1. Orchestration / durability vendor

**Alternatives**: Inngest Agent Kit, Temporal TS, Restate, DBOS Transact, Cloudflare Workflows / Durable Objects, Trigger.dev, Resonate.io, plain async + bespoke checkpointer.

**Why LangGraph.js**:
- Native graph + state machine (matches our architecture).
- Native `interrupt()` / `Command({ resume: … })` for HITL (no custom plumbing).
- Native `SqliteSaver` checkpointer (zero setup; works on HF Spaces).
- One library covers orchestration, durability, and HITL.

**Considered hybrid**: LangGraph for graph + DBOS/Temporal for durability. Rejected: unnecessary complexity; LangGraph already provides both well enough for MVP.

### 2. HITL trigger policy

**Alternatives**:
- **Always (every conflict)**: Modal fatigue; users interrupted even for minor unsupported effects.
- **Never (skip HITL)**: Silent quality loss; design doc (01) requires user-visible surface for core mechanic conflicts.
- **Only on core_mechanic severity** ✓: Aligns with win condition / turn structure / end-trigger rules. Everything else surfaces in summary.
- **Per-build opt-in checkbox** ('treat unsupported effects as blocking'): Considered; deferred to post-MVP.

### 3. HITL vs. unsupported_effect (different surfaces)

HITL and "unsupported effect" are *not* the same:
- **HITL** = a design choice conflict that requires human judgment. Example: "Fog of war doesn't fit win-by-territory?"
- **Unsupported effect** = the system lacks the capability. Example: "Networking for real-time sync isn't available."

Routing both through HITL gives the user no actionable choice. By separating them, unsupported effects are documented in the summary for post-build triage (e.g., "these effects require manual implementation").

### 4. API key handling

**Client storage**:
- `.env on backend` (single-tenant; no multi-user): Rejected.
- **Per-request header** ✓: Multi-user friendly; keys not persisted server-side.
- `localStorage` ✓ (vs. sessionStorage, in-memory): Persists across page reloads; XSS exposure mitigated by CSP, 'Forget keys' button, no third-party scripts.

**Key logging**: Scrub from logs + redact in error payloads. ✓

### 5. Streaming protocol

**Alternatives**:
- **SSE** ✓: One-way server→client, suits build progress + interrupt notifications, simpler, works through proxies, fits Fastify.
- **WebSocket**: Bidirectional; overkill for MVP (only /resume uses client→server).
- **Long-poll**: Higher latency; less elegant.
- **GraphQL Subscriptions**: Over-scope.

### 6. Checkpointer backing store

**Alternatives**:
- **In-memory**: No resume on restart.
- **SQLite** ✓: Zero infra; fits HF /data dir; easy migration to Postgres later.
- **Postgres**: Overkill for MVP; introduces dependency.
- **Redis**: Ephemeral; not suitable for durability.

### 7. Concurrency model

- **Single in-flight build per thread_id** ✓: Prevents race conditions on the same bundle.
- **Multiple builds run concurrently** ✓: Different thread_ids, each with its own checkpoint.
- **Rate limiting per-LLM-key**: Deferred; rely on provider rate limits for MVP. Simple token bucket if observed to be needed.
- **Worker pool**: Deferred; single-user MVP.

### 8. Provider-agnostic LLM via initChatModel

Allows user to choose OpenAI, Anthropic, Ollama, or Groq at build time. Supports future providers without code changes. ✓

### 9. Resume semantics on crash

**Crash scenario**: Process dies mid-build.
- **Outstanding builds are not auto-resumed on boot**: Could redo expensive LLM work.
- **Client reconnects**: `GET /builds/:id/stream` resumes from checkpoint if one exists.
- **User POSTs /resume**: Decision is queued; next stream attach applies it and continues.

---

## Interfaces / data contracts

### BuildState (Zod schema)

See §2 (Locked decisions, node 1) for the full schema. Key fields:

- `bundle_id`: UUID; also the thread_id for checkpointing.
- `llm_api_key`, `search_api_key`: Held in state only; never persisted.
- `rules_dsl`: Typed RulesDSL (cf. doc 03).
- `conflicts`: Array of Conflict objects (id, description, severity, rule_id, suggestion).
- `user_decision`: Merge target for resume payload.
- `errors`: Captured errors from any node.

### Graph wiring (pseudo-TS)

```typescript
const graph = new StateGraph(BuildState)
  .addNode('classify', classifyNode)
  .addNode('rules_agent', rulesAgentNode)
  .addNode('conflict_review', conflictReviewNode)
  .addNode('asset_agent', assetAgentNode)
  .addNode('frontend_agent', frontendAgentNode)
  .addNode('assemble_bundle', assembleBundleNode)
  .addEdge('classify', 'rules_agent')
  .addEdge('rules_agent', 'conflict_review')
  .addConditionalEdges(
    'conflict_review',
    (state) => state.conflicts?.some(c => c.severity === 'core_mechanic') ? 'interrupt' : 'continue',
    {
      interrupt: 'asset_agent', // Actually: interrupt() call; state is checkpointed
      continue: 'asset_agent'
    }
  )
  .addEdge('asset_agent', 'frontend_agent')
  .addEdge('frontend_agent', 'assemble_bundle')
  .setEntryPoint('classify')
  .setFinishPoint('assemble_bundle')
  .compile();
```

*Note*: The `interrupt()` is called *inside* the `conflict_review` node body, not via a separate edge.

### Resume flow

```typescript
// Client POSTs /builds/:id/resume
{
  decision: {
    [conflict_id]: 'accept' // or 'override' or { value: any, rule_override: string }
  }
}

// Backend handler:
state.user_decision = request.decision;
state = await graph.invoke(state, {
  configurable: { thread_id: bundleId }
  // Resumes from last checkpoint; conflict_review now checks user_decision
});
```

### API response formats

See §2, node 7 (HTTP surface) for endpoint table. Example responses:

**POST /builds**:
```json
{
  "bundle_id": "550e8400-e29b-41d4-a716-446655440000",
  "stream_url": "/builds/550e8400-e29b-41d4-a716-446655440000/stream"
}
```

**GET /bundles/:id**:
```json
{
  "bundle_id": "550e8400-e29b-41d4-a716-446655440000",
  "prompt": "Chess with fog of war",
  "mode": "build",
  "rules_dsl": { "game": { … }, "entities": { … } },
  "conflicts": [ { "id": "conflict_0", "severity": "non_core", "description": "…" } ],
  "asset_manifest": { … },
  "created_at": "2025-05-17T14:15:59Z",
  "status": "completed"
}
```

### Log scrubbing policy

**Patterns to redact**:
- `sk-*`, `sk_*` (OpenAI key prefix): redact entirely.
- `*_api_key`, `*_token` (value): redact, log key name only.
- Full request/response bodies with keys: log only content-type and size (bytes).

**Example log entry**:
```json
{
  "timestamp": "2025-05-17T14:15:59.123Z",
  "level": "info",
  "node": "rules_agent",
  "event": "llm_invoke",
  "bundle_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Invoking OpenAI GPT-4",
  "llm_provider": "openai",
  "llm_api_key": "[REDACTED]",
  "prompt_tokens": 234,
  "response_tokens": 567
}
```

---

## Worked example: Chess build with interrupt

### Scenario 1: Happy path (no core_mechanic conflicts)

**User action**: POST /builds with prompt = "Chess"

1. **Graph invoked** with `bundle_id = 550e8400-e29b-41d4-a716-446655440000` (thread_id).
2. **classify node**: Analyzes "Chess" → `prompt_type = 'game_rules'`. Emits SSE `update` event. ✓
3. **rules_agent node**: 
   - Searches for Chess rule templates; fetches FIDE standard rules.
   - Generates RulesDSL: `{ game: { pieces: […], board_setup: […] }, actions: { move: { … } }, win_condition: { checkmate: … } }`.
   - Detects 2 non-core conflicts: "Pawn promotion not fully specified" (severity: non_core), "50-move draw rule" (severity: non_core).
   - Emits SSE `update { node: 'rules_agent', conflicts: […] }`. ✓
4. **conflict_review node**: 
   - Checks conflicts: none have `severity === 'core_mechanic'`.
   - No interrupt; passes through.
   - Emits SSE `update { node: 'conflict_review', status: 'skipped', non_core_conflicts: 2 }`. ✓
5. **asset_agent node**: Generates manifest with chess piece icons (placeholder URLs). Emits SSE `update`. ✓
6. **frontend_agent node**: Generates game.js with a React board component. Emits SSE `update`. ✓
7. **assemble_bundle node**: 
   - Writes `/bundles/550e8400…/bundle.json` (metadata + rules_dsl + conflicts + asset_manifest).
   - Writes `/bundles/550e8400…/game.js`.
   - Emits SSE `done { bundle_id, bundle_path, summary: { … } }`. ✓

**User sees**: 6 update events, 1 done event. Build completes in ~10 seconds. Non-core conflicts appear in the summary.

---

### Scenario 2: Core mechanic conflict (interrupt)

**User action**: POST /builds with prompt = "Catan with fog of war"

1. **Graph invoked** with `bundle_id = 660f9501-e39c-52e5-b827-557766551111` (thread_id).
2. **classify**, **rules_agent**: (as above) Generate RulesDSL for Catan. ✓
3. **Conflict detected**: Fog of war mechanic conflicts with "Win by longest road" (a win condition). The system flags this as `{ id: 'conflict_fog_of_war', severity: 'core_mechanic', description: 'Fog of war obscures longest-road tradeoffs; win condition ambiguous.' }`.
4. **conflict_review node**:
   - Checks conflicts: `conflict_fog_of_war.severity === 'core_mechanic'`.
   - **Calls `interrupt()`**: State is checkpointed with `conflicts = [conflict_fog_of_war]`.
   - Emits SSE `interrupt { conflicts: […], prompt_to_user: 'Fog of war conflicts the longest-road win condition. Choose: accept conflict, override with different win condition, or remove fog of war?' }`. ✓
5. **Graph pauses**: Awaits resume.
6. **Client shows modal**: User picks "Override with 'most resources' win condition instead of longest road".
7. **Client POSTs** `/builds/660f9501.../resume { decision: { conflict_fog_of_war: { value: 'most_resources_win', rule_override: 'win_condition: { most_resources: true, longest_road: false }' } } }`.
8. **Backend handler**:
   - Merges decision into `state.user_decision`.
   - Resumes graph from checkpoint (conflict_review node).
9. **conflict_review node resumes**: Applies user_decision; updates rules_dsl to reflect override. Passes through. ✓
10. **asset_agent**, **frontend_agent**, **assemble_bundle**: (as above) ✓

**User sees**: update + interrupt (modal) + update (after resume) + ... + done.

---

## Open questions & follow-ups

1. **Auto-resume of in-flight builds on backend boot**: Currently requires client reattach. Should the system auto-resume all outstanding builds on startup? Risk: redo paid LLM work. Deferred to post-MVP monitoring.

2. **Multi-tenant key management**: Currently per-request localStorage + scrubbed from logs. For production, consider encrypted per-user key vaults (e.g., AWS Secrets Manager, HashiCorp Vault). Deferred.

3. **LangSmith / Langfuse tracing**: Observable LLM call tracing for debugging and cost analysis. Deferred; pino logs only for MVP.

4. **Backpressure & concurrency limits**: Currently supports parallel builds (different thread_ids). If concurrent load spikes, should we queue builds or limit per-user? Deferred; single-user MVP.

5. **Token-bucket rate limiting per LLM key**: Deferred; rely on provider rate limits. Implement if observed.

6. **HITL beyond conflict_review**: E.g., asset preview approval, game.js code review modal. Out of scope for MVP; consider for post-MVP feature gates.

7. **Checkpoint retention policy**: How long do we keep completed build checkpoints? Indefinite (disk usage risk) or TTL (e.g., 30 days)? Deferred.

---

## References

- **Doc 01** — Architecture & philosophy: Overview of the 6-node orchestrator, ECS model, and HITL integration.
- **Doc 02** — Entity & conflict schema: Detailed Conflict shape, severity levels, asset_manifest structure, bundle.json format.
- **Doc 03** — Rules DSL: RulesDSL grammar, rule composition, unsupported_effect vs. core conflict distinction.
- **Doc 04** — Rules agent (LLM): Prompts, search/fetch strategy, conflict surfacing, caching.
- **Doc 06** — Bundle & runtime: Bundle assembly, game.js wrapper, asset serving, client-side initialization.
- **LangGraph.js docs**: https://js.langchain.com/docs/langgraph
- **Zod validation library**: https://zod.dev
- **Fastify framework**: https://www.fastify.io
- **Pino logger**: https://getpino.io

---

**Document status**: Approved for MVP implementation.  
**Last updated**: 2025-05-17  
**Author**: Agentic Board Game Builder Team
