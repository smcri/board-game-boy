# Agentic Board Game Builder

> Turn a board-game name or a rules document into a browser-playable game,
> using an agentic build pipeline and a generic deterministic runtime.

**Status:** Phase 1 implementation landed. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the runbook.

## Quickstart

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev          # backend on :8787, UI on :5173
```

For an end-to-end smoke test without the UI:
```bash
pnpm smoke --backend http://localhost:8787 \
           --llm ollama --model llama3.1:8b \
           --prompt "Tic-Tac-Toe" --mode known_game
```

---

## What this is

The Agentic Board Game Builder is split into two clearly separated phases:

- **Phase 1 — Build.** An agentic pipeline takes a user prompt (e.g.,
  *"Terraforming Mars"*, *"Catan with fog of war"*, or a pasted custom rules
  document) and produces a self-contained, downloadable game bundle.
- **Phase 2 — Runtime.** The bundle boots into a browser and is played by a
  generic, deterministic engine. No LLM calls happen at play time.

The handoff is a single artifact:

```
bundles/{bundle_id}/
  bundle.json          # rules + asset manifest + metadata
  assets/*.svg         # templated SVGs filled by the asset agent
  game.js              # self-contained Vite IIFE — boots the engine
```

## Design documents (Phase 0)

The full architecture is captured in `docs/design/`:

| # | Document |
|---|---|
| 00 | [Index & decisions at a glance](docs/design/00-index.md) |
| 01 | [Overview & Architecture](docs/design/01-overview-and-architecture.md) |
| 02 | [State Model (ECS)](docs/design/02-state-model-ecs.md) |
| 03 | [DSL & Rule Executor](docs/design/03-dsl-and-rule-executor.md) |
| 04 | [Rules Agent Pipeline](docs/design/04-rules-agent-pipeline.md) |
| 05 | [Orchestrator & HITL](docs/design/05-orchestrator-and-hitl.md) |
| 06 | [Bundle & Runtime](docs/design/06-bundle-and-runtime.md) |

Each doc has a **Trade-offs considered** section enumerating the alternatives
we evaluated and rejected. Point-in-time decisions are recorded as ADRs under
[`docs/decisions/`](docs/decisions/).

## Stack at a glance

- TypeScript on Node 20+; pnpm workspaces monorepo.
- Orchestrator: **LangGraph.js** with `SqliteSaver` checkpointer and
  `interrupt()`-based human-in-the-loop (only for core-mechanic conflicts).
- LLM providers (user-selectable): **OpenAI, Anthropic, Groq, Ollama**.
- Search providers (user-selectable): **Tavily, Brave, SerpAPI** + direct
  fetch via undici + Mozilla Readability + pdf-parse.
- Backend HTTP: **Fastify** + SSE.
- Builder UI: **Vite + React + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK UI** (all OSS).
- Runtime: **ECS engine + generic renderer**; one `game.js` per bundle.
- Validation: **Zod** end-to-end with structured-output LLM calls.

## Deployment topology (MVP)

```
GitHub repo                  GitHub Actions                       Runtimes
───────────                  ──────────────                       ────────
push main ─▶ ci.yml ─▶ tests
          ─▶ pages.yml         ─▶ build UI ──▶ GitHub Pages (UI + published bundles)
          ─▶ backend-deploy-hf ─▶ HF Space (Docker, /data persistent)
          (later)
          ─▶ backend-deploy-do ─▶ DigitalOcean App (Docker, /var/data volume)

Browser ◀── HTTPS + SSE + CORS ─── current backend (HF for MVP, DO later)
```

- Backend host (MVP): **Hugging Face Spaces (Docker SDK)** — free, persistent `/data`, SSE works.
- Migration target: **DigitalOcean App Platform** — workflow shipped but disabled by default.
- UI host: **GitHub Pages**.

## API keys

- Keys live only in the user's browser `localStorage`.
- Sent per request as `X-LLM-API-Key` / `X-SEARCH-API-Key` headers.
- Never persisted server-side; scrubbed from logs and error payloads.
- A **"Forget keys"** button in Settings clears them on demand.
- Strict CSP + no third-party scripts in the UI mitigate XSS exposure.

## Repository layout (planned for Phase 1)

```
/
  packages/shared/           Zod schemas + TS types (single source of truth)
  apps/
    backend/                 Fastify + LangGraph + agents + assembler
    ui/                      Vite + React Builder UI
    scaffold/                ECS engine + generic renderer; emits game.js
  bundles/                   Build outputs (gitignored)
  scripts/
    publish-bundle.ts        Push a bundle to gh-pages
  docs/design/               Architecture documents (this phase)
  docs/decisions/            ADRs
  .github/workflows/         CI + Pages + HF deploy + DO deploy (guarded)
```

## Phase plan

- **Phase 0 (now):** design documents under `docs/design/`. Reviewed by user before any code lands.
- **Phase 1:** implementation in three parallel tracks (backend, scaffold, UI) after a sequential foundation track that lands `packages/shared/`.
- **Integration pass:** assembler wiring, Hugging Face deploy, smoke tests with Ollama + Tavily and OpenAI + Brave.

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgements

Built on top of LangGraph.js, LangChain, Fastify, Vite, React, Tailwind, shadcn/ui,
the Vercel AI SDK, Hugging Face Spaces, and a handful of LLM/search providers.
All choices and their alternatives are recorded in `docs/design/`.
