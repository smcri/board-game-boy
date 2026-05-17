# Agentic Board Game Builder MVP: Overview & Architecture

**Reference design:** board_game_builder_design.md.pdf

## Purpose & Scope

The Agentic Board Game Builder is a tool for creators to design playable board games through natural language conversation with an AI agent. The MVP delivers an end-to-end workflow:

1. **Builder phase** (backend + UI): user describes a game → agent reasons over design, searches the web, proposes rules and mechanics
2. **Handoff**: game bundle (JSON rules + assets + runtime code) generated once and exported
3. **Runtime phase** (Phase 2, out of scope): players load bundle into a minimal game engine and play

This document covers **Phase 1 only** — the agentic, generative builder. Phase 2 (the deterministic game runtime) is deferred and will be a separate system.

**Scope boundaries:**
- ✅ Multi-turn agentic conversation with Claude/GPT/Ollama/Groq
- ✅ Web search (Tavily, Brave, SerpAPI) to ground rules in real game mechanics
- ✅ Structured output for game state (ECS model, DSL primitives)
- ✅ Builder UI with streaming chat, board preview, bundle export
- ✅ Self-contained game bundles ready for handoff
- ✅ GitHub Pages hosting for bundles; HF Spaces hosting for backend
- ❌ Phase 2 runtime engine (deferred)
- ❌ Same-device or networked multiplayer (deferred)
- ❌ Custom image generation (deferred)
- ❌ Tier-2 effect_script sandbox (deferred; see doc 03)

---

## Locked Decisions

| Decision | Rationale |
|----------|-----------|
| **Two-phase split** (Phase 1: agentic, Phase 2: runtime code-only) | Clean separation of concerns; enables separate versioning and deployment; handoff is a single, self-contained game bundle. |
| **Language: TypeScript + Node 20+** | Single language across backend, UI, and scaffold; best tooling for rapid iteration. |
| **Monorepo: pnpm workspaces** | Shared types, efficient dependency management, single CI pipeline. |
| **Orchestrator: LangGraph.js** | Graph topology for complex multi-agent flows; native HITL with `interrupt()` and `Command(resume)`; SqliteSaver durability; largest TypeScript ecosystem. |
| **LLM abstraction: LangChain initChatModel** | Provider-agnostic; four named providers tested: OpenAI, Anthropic, Ollama (local, free), Groq (free tier). |
| **Search: user choice at runtime** | Tavily, Brave, or SerpAPI; results enriched with direct fetch (undici), Mozilla Readability, pdf-parse. |
| **HTTP: Fastify + @fastify/cors + SSE** | Minimal ceremony, native SSE support, excellent performance, straightforward streaming. |
| **Validation: Zod everywhere** | Structured LLM output validated; 1 automatic retry on failure; type-safe all the way. |
| **Builder UI: Vite + React + TypeScript + Tailwind + shadcn/ui** | Modern, fast, all open source; Vercel AI SDK for streaming UI primitives. |
| **Phase 2 scaffold: Vite build.lib (IIFE)** | Each game bundle is a single `game.js` — no build step for player. |
| **Bundle structure: bundle.json + assets/ + game.js** | Minimal footprint; assets are PNG/WebP; game.js is self-contained IIFE. |
| **Backend hosting: Hugging Face Spaces (Docker SDK)** | Free, persistent `/data` directory, SSE works, easy redeploy on push. |
| **UI hosting: GitHub Pages** | Free, static, perfect for Vite output; bundles can optionally be published to gh-pages for shareable URLs. |
| **CI/CD: GitHub Actions** | `ci.yml` (lint, test), `pages.yml` (publish UI), `backend-deploy-hf.yml` (auto-deploy to HF on main). DigitalOcean workflows included but disabled. |
| **Monorepo layout** | `/packages/shared`, `/apps/{backend,ui,scaffold}`, `/bundles`, `/scripts`, `/.github/workflows`, `/docs/design`. |
| **State model: ECS** | See doc 02; referenced here for context. |
| **DSL: closed primitives** | `set`, `inc`, `move`, `choose`, `if`, `phase`, atomic, random. See doc 03. |
| **Visibility: per-path/per-component** | Hidden information assigned at game-design time, not via crypto (deferring multiplayer). |
| **API keys: localStorage + per-request headers** | Sent as `X-LLM-API-Key` and `X-SEARCH-API-Key`; never persisted server-side; scrubbed from logs; 'Forget keys' button in UI. |
| **HITL trigger: core_mechanic severity only** | Only conflicts marked `severity: 'core_mechanic'` in agent decisions block and prompt user; routine design refinement is quiet. |

---

## Trade-offs Considered

### Orchestration Framework

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **LangGraph.js** (chosen) | Native TS, graph topology, built-in HITL + durability, largest ecosystem | Smaller than Python LangGraph | ✅ |
| LangGraph (Python) | Mature, all reference docs | Splits TS + Python; WSGI/ASGI adds ops burden | ❌ |
| Genkit (Go) | Fast | TS not first-class; agent patterns less familiar | ❌ |
| Eino (Go) | Multi-lang SDKs | Go backend contradicts single-language goal | ❌ |
| LangChainGo | Comprehensive | See Eino | ❌ |
| Mastra | Modern, TS-native | Smaller ecosystem; HITL story unclear | ❌ |
| Vercel AI SDK alone | Minimal, fast | No graph; no durability; HITL via PR comments only | ❌ |
| Inngest Agent Kit | Task queue + resilience | Overkill for MVP; add ops complexity | ❌ |
| Temporal | Enterprise-grade durability | Separate infrastructure; too heavyweight | ❌ |
| Restate | Modern state machine | Similar to Temporal; adds complexity | ❌ |
| AutoGen (Python) | Agent autonomy | Python-only; would split language | ❌ |
| Semantic Kernel | Multi-lang | C# optimized, TS an afterthought | ❌ |
| CrewAI | Autonomous agents | Python-only | ❌ |
| Trigger.dev | Job orchestration | Job queue, not agent graphs | ❌ |
| DBOS Transact | Durable transactional ops | Different paradigm; not agent-focused | ❌ |
| Cloudflare Workflows | Serverless durability | Cloudflare-only, proprietary | ❌ |
| Resonate.io | Distributed resilience | Event sourcing paradigm, not graph-native | ❌ |

**Verdict:** LangGraph.js dominates on ecosystem maturity, native TS, graph topology, and HITL—a clear win for a stateful multi-turn agent.

---

### Language

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **TypeScript (chosen)** | Single language; best TS agent libraries; Fastify, Vite, React ecosystem | Slightly slower than compiled languages | ✅ |
| Python (+ LangGraph) | Mature agent ecosystem | Splits language; adds Python/Node infra | ❌ |
| Go | Fast, compiled | Smaller agent ecosystem in Go; duplicates effort | ❌ |

**Verdict:** Single-language end-to-end (backend + UI + scaffold) is a significant UX and ops win.

---

### HTTP Framework

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Fastify (chosen)** | Native SSE support, minimal middleware, fast, mature | Smaller than Express | ✅ |
| Express | Ubiquitous, large middleware ecosystem | More ceremony; SSE less idiomatic | ❌ |
| NestJS | Full-featured, decorators | Heavyweight for a single orchestrator endpoint | ❌ |
| Hono | Fast, Cloudflare-first | Designed for Workers, not Node.js | ❌ |
| Next.js API routes | Integrated with React | Not ideal for non-Vercel hosting | ❌ |
| SvelteKit | Integrated | Tied to Svelte | ❌ |
| Remix | Full-stack | React-specific | ❌ |
| tRPC | Type-safe RPC | Overkill for a few endpoints | ❌ |
| µWebSockets | Fastest | C++ FFI, operational complexity | ❌ |
| Koa | Middleware-first | Similar to Express, less mature ecosystem | ❌ |

**Verdict:** Fastify is the sweet spot—minimal boilerplate, native streaming, and proven in production.

---

### UI Framework & Generative-UI Library

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Vercel AI SDK UI + shadcn/ui (chosen)** | Apache 2.0 OSS, streaming primitives, framework-agnostic, free | Vercel hosting is paid (we use Pages) | ✅ |
| assistant-ui | Specialized for streaming | Smaller community, less documentation | ❌ |
| CopilotKit OSS | Copilot-like UX | More opinionated; React plugin model | ❌ |
| LangGraph SDK React hooks | Tight LangGraph integration | Smaller ecosystem; less UI polish | ❌ |
| Chainlit | Full chat UI | Python-only | ❌ |
| Streamlit | Rapid prototyping | Python-only | ❌ |
| Gradio | Easy demos | Python-only | ❌ |

**Verdict:** Vercel AI SDK is free, well-maintained, and streaming-first—the ideal choice for builder chat.

---

### Build Tool

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Vite (chosen)** | Fast dev startup, modern, ESM-first | Smaller ecosystem than Webpack | ✅ |
| Webpack | Industry standard, extensive plugins | Slow startup, verbosity | ❌ |
| Parcel | Zero-config | Less control for complex monorepos | ❌ |
| Esbuild | Fastest | Minimal features; Vite wraps it well | ❌ |
| Rollup | Flexible bundler | More manual config than Vite | ❌ |
| Turbopack | Modern, fast | Unstable; Vercel-first | ❌ |

**Verdict:** Vite is the modern default—fast cold start, minimal config, perfect for monorepo + dynamic imports.

---

### Backend Hosting

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Hugging Face Spaces (chosen)** | Free, persistent `/data`, SSE works, easy redeploy | HF UI overlay adds friction | ✅ MVP |
| **DigitalOcean App Platform** | Custom domains, persistent volumes, predictable billing | Paid (though very cheap) | ✅ Migration target |
| Fly.io | No permanent free tier | $5 credit expired after trial | ❌ |
| Render Web Service (free) | Free tier exists | Sleeps after inactivity; ephemeral disk | ❌ |
| Railway | Cheap trial credit | Credit-based, not sustainable | ❌ |
| Koyeb | Free tier | No persistent disk | ❌ |
| Cloudflare Workers | Serverless | Node.js runtime not supported | ❌ |
| Railway | Trial-based, not sustainable | Trial credit runs out | ❌ |
| Self-hosted | Full control | Infra ops overhead | ❌ MVP |

**Verdict:** HF Spaces is the pragmatic free choice for MVP. DigitalOcean is documented and configured for smooth migration once metrics justify cost.

---

### UI Hosting

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **GitHub Pages (chosen)** | Free, static, perfect for Vite output | No server-side rendering | ✅ |
| GitHub Actions (no Pages) | Single workflow | No persistent artifact hosting; HITL via PR comments only | ❌ |
| Self-hosted UI | Full control | Ops overhead; duplicates backend infra | ❌ |

**Verdict:** Pages is built for exactly this use case.

---

### CI/CD

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **GitHub Actions (chosen)** | Free, already in GitHub, easy secrets management | Not suitable as a server | ✅ |
| External CI (CircleCI, Travis) | Specialized | Extra account, extra complexity | ❌ |

**Verdict:** Actions + remote runtime (HF/DO) is the correct split.

---

### LLM Provider Posture

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Provider-agnostic (chosen)** | No lock-in; user choice; four named providers tested | Some setup per provider | ✅ |
| OpenAI-only | Simplest onboarding | Vendor lock-in; no free option | ❌ |
| Anthropic-only | Excellent models | Lock-in; no free option | ❌ |
| OpenRouter aggregator | Aggregates multiple | Extra hop; adds cost | ❌ |

**Verdict:** initChatModel wins—let users pick their provider and model.

---

### Including Free/Local Provider

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Yes: Ollama + Groq (chosen)** | Contributors can test with no paid keys; full feature parity | Slightly slower LLM (Ollama is local) | ✅ |
| No free provider | Simpler | Barrier to contributor testing | ❌ |

**Verdict:** Groq (free tier, cloud) + Ollama (local, free) together unlock zero-cost testing.

---

### API Key Storage

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **localStorage + per-request (chosen)** | UX: enter once, persist; CSRF-safe if CSP strict | XSS risk; mitigated by CSP + 'Forget keys' button | ✅ |
| sessionStorage only | Auto-clears on tab close; safer | Poor UX; re-enter every session | ❌ |
| .env on backend | Server-side, not exposed | Multi-user friction; requires login | ❌ |
| In-memory | Fast, no persistence | Lost on page reload; poor UX | ❌ |

**Verdict:** localStorage with strict CSP and a 'Forget keys' button is the pragmatic choice.

---

### API Key Delivery

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Per-request header (chosen)** | Multi-user friendly; never persisted server-side | Requires header forwarding in agent code | ✅ |
| .env on backend | Simple server-side config | Single user; scaling friction | ❌ |

**Verdict:** Headers are the multi-user default for MVP.

---

### MVP Content: Stubs vs Real Agents

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Real agents (chosen)** | User gets a working MVP today; proof of concept is credible | Requires real LLM calls; latency in UI | ✅ |
| Stub agents (deterministic) | Fast, predictable, testable | Doesn't prove the agentic concept | ❌ |

**Verdict:** Users want a working MVP now; stubs are testing only.

---

### MVP Scope

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **C: Backend + UI + Scaffold + Real Engine (chosen)** | True end-to-end; bundles are generated and exportable | Most engineering effort | ✅ |
| A: Backend only | Smallest scope | No UI; incomplete story | ❌ |
| B: Backend + UI | Better story | No bundles; no Phase 2 handoff | ❌ |

**Verdict:** End-to-end is the goal; a bundle that can be handed off proves the design.

---

### Web Fetching Strategy

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Search API + Direct Fetch + Readability + PDF (chosen)** | User picks search provider; fallback to direct fetch; rich content extraction | Three-way integration complexity | ✅ |
| None | Simplest | Agent has no grounding; poor-quality games | ❌ |
| LLM-native search only | No external API | Models have outdated info; no web browsing | ❌ |
| Search API only | Simple, reliable | Can't fall back if API fails | ❌ |
| Direct fetch only | No external API needed | No structured results; agent struggles | ❌ |

**Verdict:** Three-tier strategy (search → fetch → readability) gives both flexibility and robustness.

---

## Interfaces / Data Contracts

### Monorepo Layout

```
agentic-board-game-builder/
├── packages/
│   └── shared/
│       ├── types/
│       │   ├── game.ts         # ECS model (doc 02)
│       │   ├── dsl.ts          # DSL primitives (doc 03)
│       │   ├── chat.ts         # ChatMessage, ThreadState
│       │   └── bundle.ts       # BundleManifest
│       └── utils/
│           ├── validation.ts   # Zod schemas
│           └── search.ts       # Search wrapper
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── index.ts        # Fastify server, SSE endpoint
│   │   │   ├── agent.ts        # LangGraph orchestrator
│   │   │   ├── search.ts       # Provider dispatch (Tavily/Brave/SerpAPI)
│   │   │   └── bundle.ts       # Bundle generation
│   │   └── package.json
│   ├── ui/
│   │   ├── src/
│   │   │   ├── App.tsx         # Main layout
│   │   │   ├── components/
│   │   │   │   ├── Chat.tsx    # Vercel AI SDK chat + streaming
│   │   │   │   ├── Settings.tsx # API key input + provider picker
│   │   │   │   └── Preview.tsx # Board ECS state viewer
│   │   │   └── hooks/
│   │   │       └── useBackend.ts # Fetch + SSE
│   │   └── package.json
│   └── scaffold/
│       ├── src/
│       │   ├── index.ts        # Game bundle template
│       │   └── runtime.ts      # Phase 2 ECS runtime (minimal)
│       └── package.json
├── bundles/                    # Generated game bundles
│   └── [game-id]/
│       ├── bundle.json         # Manifest + rules
│       ├── assets/             # PNG/WebP
│       └── game.js             # IIFE export
├── scripts/
│   ├── build-scaffold.js
│   └── publish-bundles.sh
├── docs/
│   ├── design/
│   │   ├── 01-overview-and-architecture.md    (this file)
│   │   ├── 02-state-model-ecs.md
│   │   ├── 03-dsl-primitives.md
│   │   ├── 04-agent-architecture.md
│   │   ├── 05-ui-flow.md
│   │   └── 06-end-to-end-example.md
│   └── decisions/
│       └── [ADRs, cost analysis, etc.]
├── .github/
│   └── workflows/
│       ├── ci.yml              # lint, test, type-check
│       ├── pages.yml           # publish UI to gh-pages
│       ├── backend-deploy-hf.yml   # auto-deploy to HF on main
│       └── backend-deploy-do.yml   # guarded; ready for migration
├── pnpm-workspace.yaml
├── tsconfig.json
├── turbo.json
└── README.md
```

### Deployment Topology

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Repository                        │
│  (source: TS monorepo + workflows)                          │
└────────────────┬──────────────────────────────┬─────────────┘
                 │                              │
         ┌───────▼────────┐          ┌──────────▼────────┐
         │  GitHub Pages  │          │  HF Spaces (MVP)  │
         │  (UI + bundles)│          │   (Backend)       │
         │                │          │                   │
         │ • index.html   │          │ • Dockerfile      │
         │ • game.js      │          │ • PORT (7860)     │
         │ • assets/      │          │ • DATA_DIR        │
         │ (gh-pages)     │          │ • SQLITE_PATH     │
         └────────────────┘          └──────────────────┘
                 │                           │
         ┌───────▼──────────────────────────▼────┐
         │      Web Browser (Player/Creator)      │
         │                                        │
         │ • Loads index.html from Pages          │
         │ • Chat calls /api/build → HF SSE       │
         │ • Exports bundle → saves to gh-pages   │
         │ • Loads game.js to play                │
         └────────────────────────────────────────┘
```

### Environment Variables

**Backend (.env):**
```
PORT=7860
DATA_DIR=/data
BUNDLES_DIR=/data/bundles
SQLITE_PATH=/data/state.db
ALLOWED_ORIGINS=https://pages.github.com,http://localhost:5173
OLLAMA_BASE_URL=http://localhost:11434
```

**Frontend (.env.local):**
```
VITE_BACKEND_URL=https://<hf-space-username>-board-game-builder.hf.space
```

**GitHub Secrets (Actions):**
- `HF_TOKEN` — Hugging Face API token for deployment
- `HF_SPACE_ID` — Space ID (user/space-name)
- `DIGITALOCEAN_ACCESS_TOKEN` — (later, for migration)
- `DO_APP_ID` — (later)
- `DO_REGISTRY` — (later)

### Schema References (Deferred to Other Docs)

| Type | Document | Notes |
|------|----------|-------|
| `GameState` (ECS) | doc 02 | Entities, components, systems |
| `Rule` (DSL) | doc 03 | set, inc, move, choose, if, phase, atomic, random |
| `ChatMessage`, `ThreadState` | doc 04 | Agent state, HITL checkpoints |
| `BundleManifest` | doc 06 | File listing + rule hash |

---

## Worked Example

**Scenario:** User opens builder, picks **Ollama** (local LLM) + **Tavily** (search), types "Chess", and hits "Generate".

**Monorepo files involved:**

1. **UI layer** (`apps/ui/src/components/Chat.tsx`):
   - User input "Chess" → calls `POST /api/build` with headers `X-LLM-API-Key: ollama` and `X-SEARCH-API-KEY: tavily_key`.

2. **Backend entry** (`apps/backend/src/index.ts`):
   - Fastify SSE handler receives request; extracts headers.
   - Passes control to `agent.ts`.

3. **LangGraph orchestrator** (`apps/backend/src/agent.ts`):
   - Initializes `initChatModel('ollama', ...)` from LangChain.
   - Creates graph: `generateGameDesign` → `searchMechanics` → `validateRules` → `generateBundle`.
   - Invokes with input `{ prompt: 'Chess', thread_id: <uuid> }`.
   - SqliteSaver checkpoints after each node.

4. **Search dispatch** (`apps/backend/src/search.ts`):
   - Agent calls `searchMechanics('chess rules')`.
   - Routes to Tavily API; fetches top results; calls `undici` to fetch full HTML; runs Mozilla Readability; extracts text.

5. **Bundle generation** (`apps/backend/src/bundle.ts`):
   - Final rules validated against `packages/shared/types/dsl.ts` (Zod schema).
   - Calls `scaffold` builder to transpile DSL → `game.js` (IIFE).
   - Writes `bundles/<game-id>/bundle.json`, `assets/`, `game.js`.

6. **Streaming response** (`apps/backend/src/index.ts`):
   - SSE stream sends incremental agent outputs back to UI.
   - UI (`apps/ui/src/hooks/useBackend.ts`) renders chat messages in real time.

7. **Bundle export** (`apps/ui/src/components/Preview.tsx`):
   - User clicks "Download Bundle".
   - Frontend fetches `bundle.json` + `game.js` from backend.
   - Zips to `chess_bundle.zip` or publishes to gh-pages.

**Key files in the dance:**
- `packages/shared/types/dsl.ts` — validates rules
- `apps/backend/src/agent.ts` — orchestrates the flow
- `apps/backend/src/search.ts` — routes to Tavily
- `apps/ui/src/hooks/useBackend.ts` — handles SSE
- `apps/scaffold/src/index.ts` — builds game.js

Full trace is in **doc 06** (End-to-End Example).

---

## Open Questions & Follow-ups

### Tier-2 Effect Script Sandbox
**Status:** Deferred (Phase 1.5)  
**Rationale:** Effect scripts are optional, complex-to-sandbox, and Phase 1 doesn't require them. Detailed trade-off in doc 03 (DSL).  
**Action:** Document sandbox options (qjs, NodeVM, v8 context) in Phase 1.5 ticket.

### Same-Device Passcode Multiplayer
**Status:** Deferred (Phase 2)  
**Rationale:** Requires HITL for turn arbitration and per-player visibility. Out of Phase 1 scope.  
**Action:** Design visibility layer in Phase 2 spec.

### Networked Multiplayer
**Status:** Deferred (Phase 3+)  
**Rationale:** Requires real-time sync, WebSocket infra, matchmaking. Much larger scope.  
**Action:** Spike external services (e.g., Colyseus, PlayFab) post-MVP.

### Image Generation for Richer Art
**Status:** Deferred (Phase 1.5)  
**Rationale:** Adds LLM cost and latency; Phase 1 focuses on mechanics.  
**Action:** Design image-generation task in Phase 1.5; consider Replicate or Hugging Face Inference API.

### Bundle Versioning & Rule Patching UX
**Status:** Deferred (Phase 1.5)  
**Rationale:** Post-generation design; requires versioning scheme and update mechanism.  
**Action:** Design "rerun with feedback" UX in Phase 1.5; consider semantic versioning on bundle.json.

### Custom Domains on Hugging Face Spaces
**Status:** n/a (HF Spaces limitation)  
**Action:** Custom domain support is part of DigitalOcean migration (included in backend-deploy-do.yml workflow).

### LangSmith Tracing & Observability
**Status:** Deferred (Phase 1.1)  
**Rationale:** MVP uses stdout logging; LangSmith is optional add-on for debugging.  
**Action:** Document LangSmith integration in ops guide; default to off.

---

## References

- **Design PDF:** board_game_builder_design.md.pdf (original requirements)
- **Doc 02:** `02-state-model-ecs.md` — Game state, entities, components, systems
- **Doc 03:** `03-dsl-primitives.md` — DSL closed primitives, validation, effect scripts
- **Doc 04:** `04-agent-architecture.md` — LangGraph nodes, interrupts, HITL flow
- **Doc 05:** `05-ui-flow.md` — Chat, board preview, export, bundle playback
- **Doc 06:** `06-end-to-end-example.md` — Full Chess trace with code snippets

---

**Author notes:**
- This document is the north star for Phase 1 implementation.
- All locked decisions are final unless explicitly escalated.
- Trade-offs section is the most important—it documents why other paths were rejected.
- Each follow-up has a clear deferral rationale and a follow-up ticket reference.
- Refer to the docs hierarchy for implementation details; this doc stays at the 30k-foot view.
