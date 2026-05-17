# Design Documents — Index

> Phase 0 deliverable for the Agentic Board Game Builder MVP.
> These documents capture the architecture, the decisions we've locked, and — critically —
> the trade-offs we considered and rejected on the way to those decisions.

## Reading order

| # | Document | Owner question it answers |
|---|---|---|
| 01 | [Overview & Architecture](./01-overview-and-architecture.md) | What are we building, how is it shaped end-to-end, and where does it run? |
| 02 | [State Model (ECS)](./02-state-model-ecs.md) | How is game state represented at runtime? |
| 03 | [DSL & Rule Executor](./03-dsl-and-rule-executor.md) | What language do the agents emit, and how does the engine run it safely? |
| 04 | [Rules Agent Pipeline](./04-rules-agent-pipeline.md) | How do we turn a prompt into a structured RulesDSL using real web sources? |
| 05 | [Orchestrator & HITL](./05-orchestrator-and-hitl.md) | How are the agents wired together, and how do we keep the human in the loop? |
| 06 | [Bundle & Runtime](./06-bundle-and-runtime.md) | What artifact ships, and how does it boot into a playable game? |

## Locked decisions at a glance

| Area | Decision | Doc |
|---|---|---|
| Language / runtime | TypeScript on Node 20+, pnpm workspaces monorepo | 01 |
| Orchestrator | LangGraph.js (StateGraph + SqliteSaver + `interrupt()` HITL) | 05 |
| Backend HTTP | Fastify + SSE | 01, 05 |
| LLM providers | OpenAI, Anthropic, Ollama, Groq via `initChatModel` | 01, 04 |
| Search providers | Tavily, Brave, SerpAPI (user picks at runtime) | 04 |
| Web fetching | undici + Mozilla Readability + pdf-parse; SQLite cache | 04 |
| Source priority | Strict: PDF > publisher > BGG > fan | 04 |
| State model | ECS (entities + components + systems) | 02 |
| DSL | Minimal-6 primitives (`set`, `inc`, `move`, `choose`, `if`, `phase`) + `atomic` + `random` | 03 |
| Hidden information | Per-component `Visibility { public \| owner \| none }`; no crypto | 02, 06 |
| HITL gate | Only `severity === 'core_mechanic'` conflicts block & prompt | 05 |
| Unsupported effects | Non-blocking; surfaced in bundle summary (engine capability gap ≠ judgement call) | 03 |
| Builder UI | Vite + React + Tailwind + shadcn/ui + Vercel AI SDK UI | 01 |
| API key storage | `localStorage`; per-request headers; never persisted server-side; "Forget keys" button | 01, 05 |
| Phase 2 runtime | Generic ECS engine + generic React renderer; one `game.js` per bundle | 06 |
| Bundle shape | `bundle.json` + `assets/*.svg` + `game.js` (self-contained Vite IIFE) | 06 |
| Backend host (MVP) | Hugging Face Spaces (Docker SDK); persistent `/data` | 01 |
| Backend host (migration target) | DigitalOcean App Platform | 01 |
| UI host | GitHub Pages | 01 |
| CI/CD | GitHub Actions (CI + Pages + HF deploy + DO deploy guarded) | 01 |

## Trade-off threads (where to find each)

| Debate | Documented in |
|---|---|
| LangGraph (JS) vs Genkit vs Eino vs LangChainGo vs Mastra vs Inngest vs Temporal vs Restate vs DBOS vs CF Workflows vs Trigger.dev vs Resonate | 01, 05 |
| Python LangGraph vs LangGraph.js | 01 |
| Fastify vs NestJS/Hono/Express/Next.js/Elysia/tRPC/AdonisJS/Encore/Koa/Restify/h3-Nitro/Moleculer/Marblejs/TSOA/Hapi/FoalTS/Ts.ED/Routing-Controllers/Feathers/Sails/Polka/µWebSockets/SvelteKit/Remix/Astro/Fresh/GraphQL Yoga | 01 |
| Vercel AI SDK UI vs assistant-ui vs CopilotKit vs LangGraph SDK React hooks vs Chainlit/Streamlit/Gradio | 01 |
| Vite vs Webpack vs Parcel vs esbuild vs Rollup vs Turbopack | 01 |
| HF Spaces vs Fly vs Render vs Railway vs Koyeb vs Cloudflare Workers vs DO App Platform | 01 |
| GitHub Pages vs GH-Actions-only vs self-hosted UI | 01 |
| OpenAI-only vs Anthropic-only vs provider-agnostic vs OpenRouter vs HuggingFace Inference | 01, 04 |
| Tavily vs Brave vs SerpAPI; LLM-native search vs dedicated API vs direct fetch | 04 |
| Strict source priority vs confidence-weighted vs search-first | 04 |
| in-memory vs sessionStorage vs localStorage for API keys | 01, 05 |
| `.env` vs per-request header for API keys | 01, 05 |
| State model: Generic dict (Option A) vs Light schema (Option B) vs ECS (Option C) | 02 |
| Specialized DSL verbs vs primitive verbs; Tier-1 templates vs Tier-2 `effect_script` sandbox | 03 |
| HITL vs `unsupported_effect`: why they are different surfaces | 03, 05 |
| SSE vs WebSocket vs long-poll vs GraphQL Subscriptions | 05 |
| SQLite vs Postgres vs Redis vs in-memory checkpointer | 05 |
| Templated SVG vs LLM-raw-SVG vs image-gen APIs vs emoji/CSS blocks | 06 |
| `game.js` packaging: IIFE vs ES module vs Module Federation | 06 |
| Generic renderer vs per-game React | 02, 06 |
| Stubs-first MVP vs real agents | 01, 06 |
| Scope: backend only (A) vs backend+UI (B) vs backend+UI+scaffold (C) | 01, 06 |

## Glossary

- **Phase 1 (Build)** — Agentic generation of a game bundle from a prompt.
- **Phase 2 (Runtime)** — Deterministic, code-only execution of a bundle in the browser.
- **Bundle** — `{bundle.json, assets/, game.js}` — the sole handoff between Phase 1 and Phase 2.
- **ECS** — Entity-Component-System runtime state model (see doc 02).
- **DSL** — The closed, declarative effect language emitted by the rules agent (see doc 03).
- **HITL** — Human-in-the-loop interrupt for core-mechanic conflicts (see doc 05).
- **RulesDSL** — The full structured output the rules agent produces: ECS entities + components + actions + win conditions + conflicts.
- **HF Spaces** — Hugging Face Spaces, the MVP backend host.
- **DO** — DigitalOcean App Platform, the documented migration target.

## Open questions (collected from all docs)

Each doc lists its own deferrals. Aggregated here for quick reference:

- Tier-2 `effect_script` sandbox (03)
- Triggered / reactive effects (03)
- DSL versioning enforcement on engine boot (03, 06)
- Same-device passcode multiplayer (06; design-doc Q4 territory)
- Networked multiplayer (out of MVP)
- Image-gen API for richer art (06)
- Bundle versioning / rule patching UX (06)
- localStorage cross-session persistence for long games (06; design-doc Q8)
- Multi-tenant key management beyond `localStorage` (05)
- LangSmith / Langfuse tracing (05)
- Auto-resume of in-flight builds on backend boot (05)
- Per-bundle `Components: declare(...)` extension (02)
- Cross-entity referential integrity validation (02)
- Multiple PDFs in the same priority bucket (04)
- Long-rulebook context handling (chunk/summarise/RAG) (04)
- Non-English rulebooks (04)
- Game-name disambiguation (04)
- LangGraph auto-resume across restarts (05)
- Renderer accessibility & mobile/touch (06)
- Bundle signature/integrity (06)
- Custom domains on HF Spaces (deferred to DO migration) (01)

## Next phase

Phase 1 (implementation) begins after these docs are reviewed and approved by the user.
Phase 1 plan:

1. **Track A** (sequential, blocking): root tooling + `packages/shared/` Zod schemas.
2. **Tracks B / C / D** (parallel): backend, scaffold engine, UI + workflows.
3. **Integration pass**: assembler wiring, HF deploy, smoke tests.
