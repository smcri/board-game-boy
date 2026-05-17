# Design Doc 6: Bundle & Runtime (Phase 2)

## Purpose & scope

This document specifies the design of the **Agentic Board Game Builder MVP's Phase 2 runtime**: how game bundles are packaged, cached, served, and executed in the browser. It covers:

- The **bundle directory contract** (bundle.json, assets/, game.js) and what each artifact contains.
- The **scaffold architecture** (engine, renderer, game config, build pipeline) that runs bundled games.
- The **assembler** (backend component) that produces optimized bundles with caching.
- The **runtime execution model**: code-driven, no LLM calls at play time.
- **Visibility enforcement** (public / owner / none) at render time.
- **Bundle sharing and hosting** via backend + GH Pages.

This is the capstone of the MVP: where a user can create a game in the Builder UI, click "Open game," and play it in a new browser tab.

---

## Locked decisions

### 1. Bundle Directory Contract

Every shipped game bundle follows this structure:

```
bundles/{bundle_id}/
  ├── bundle.json          # Metadata, rules, asset manifest, dsl_version
  ├── game.js              # Self-contained IIFE build (Vite lib mode)
  └── assets/
      ├── board.svg
      ├── card_01.svg
      ├── player_panel.svg
      └── ...
```

**bundle.json** contains:
- `bundle_id`, `version`, `metadata` (name, description, author, created_at).
- `dsl_version`: minimum engine version required to run this bundle.
- `rules_dsl`: the RulesDSL graph (from doc 03).
- `asset_manifest`: array of asset metadata (id, file, role, svg_viewbox, attrs).
- `conflicts_resolved`: DSL conflicts that the agents and user resolved.
- `conflicts_unresolved_non_blocking`: known limitations (e.g., "castling not supported").

**assets/*.svg** are templated SVGs. The asset agent (doc 05) does not generate raw SVGs; instead, it:
1. Selects a template from `/apps/backend/src/assets/templates/` (e.g., `card.svg.template`).
2. Fills in colors, labels, counts, and text fields using LLM-generated data (no image-gen APIs in MVP).
3. Writes the filled SVG to `bundles/{id}/assets/`.

**game.js** is a single self-contained IIFE (Immediately Invoked Function Expression) built by Vite in lib mode. It exports `window.BGB.boot(rootEl, bundle)`, which initializes the engine and mounts the React renderer. See **Assembler** below for how it's produced.

### 2. Scaffold Architecture

The scaffold (`/apps/scaffold/`) is the generic engine + renderer that powers all games. It is split into:

#### **Engine** (`/apps/scaffold/engine/`)

| File | Responsibility |
|------|-----------------|
| `ecs.ts` | Component store (entity-component system); provides `store.query(ComponentType)`, `store.set(entity, component)`, etc. |
| `rule-executor.ts` | Interprets RulesDSL actions (Minimal-6: *atomic*, *random*, *if-then*, *sequence*, *fork*, *phase*). Looks up DSL action by (state, trigger), executes effects, appends to event log. |
| `event-log.ts` | Append-only log of all actions + outcomes. Supports replay() and undo(). Persisted to browser localStorage (session-scoped for MVP). |
| `systems.ts` | Runs the **turn loop**: phase advance, win-condition checks, current_player toggle (for passcode-based same-device multiplayer). |

**Engine API** (TypeScript sketch):
```typescript
const engine = createEngine(bundle: BundleData);

// Dispatch an action (e.g., user clicked a move button)
engine.dispatch({ type: 'move_piece', payload: { from, to } });

// Read current game state (for renderer)
const state = engine.getState(); // returns ECS snapshot

// Subscribe to state changes
engine.subscribe((newState) => { /* re-render */ });

// Replay and undo (MVP scope: within same session)
engine.undo();
engine.replay(events: ActionLog[]);
```

#### **Renderer** (`/apps/scaffold/renderer/`)

Generic React components that **never contain per-game logic**. They query ECS and respect Visibility:

| Component | Role |
|-----------|------|
| `<Board />` | Queries `(BoardNode, Position, Asset)` components; renders board grid + pieces. |
| `<PlayerPanel />` | Queries `Player` + `Resource` + `Hand` components; displays scores, phase, current player. |
| `<Hand player={...} />` | Renders player's cards/tokens; respects visibility (e.g., only owner's hand shown when visibility='owner'). |
| `<ActionBar />` | Lists valid actions; dispatches to engine on click. Queried from ECS. |

Each component uses a `useECS(query)` hook (or selector pattern) to subscribe to component changes. **Visibility is enforced at render time**:

```typescript
// Pseudocode in renderer
if (component.visibility === 'public' || 
    (component.visibility === 'owner' && component.owner === state.currentPlayer)) {
  // Render the component
}
```

No cryptographic hiding; protection against *accidental* viewing (doc 02).

#### **Game Config** (`/apps/scaffold/game/`)

Contains **per-bundle overrides** (written by the assembler):

| File | Purpose |
|------|---------|
| `board-config.json` | Board topology: node IDs, coordinates, neighbour relationships, render hints. |
| `asset-manifest.json` | Asset URIs, roles, viewBox dimensions. |
| `card-templates.tsx` | Optional: custom card rendering (usually not needed; generic card is fine). |
| `player-panel.tsx` | Optional: custom player panel (usually not needed). |

#### **Entry & Build** (`main.tsx`, `vite.config.ts`)

**main.tsx** is the boot sequence:
1. Fetch `bundle.json` from `/bundles/{id}/bundle.json` (separate from game.js for cache-busting).
2. Call `createEngine(bundle)` → engine reads RulesDSL + assets.
3. Mount `<App>` renderer to DOM.

**vite.config.ts** is configured to:
- Build mode: `build.lib` with entry `main.ts`.
- Output: `dist/game.js` (single IIFE, no external dependencies except React, which is bundled).
- Target: self-contained, runnable from any static host.

### 3. Assembler (`/apps/backend/src/assembler.ts`)

The assembler is a backend service that produces optimized bundles. On user request (e.g., "Build & preview game"):

1. **Write bundle.json** to `bundles/{bundle_id}/bundle.json` with rules DSL + asset manifest from prior agents.
2. **Confirm assets exist** in `bundles/{id}/assets/`.
3. **Compute cache key**: `hash(scaffold-sources) + hash(bundle.json) + hash(asset-manifest)`.
4. **Cache lookup**:
   - **Miss**: Overwrite `/apps/scaffold/game/*` with per-bundle versions (board-config.json, asset-manifest.json, etc.), run `pnpm --filter scaffold build`, copy `dist/game.js` → `bundles/{id}/game.js`. Cache the result.
   - **Hit**: Copy cached `game.js` to `bundles/{id}/game.js`.
5. **Return**: bundle metadata + URLs for bundle.json, game.js, and assets.

This caching is critical on resource-constrained hosting (e.g., HuggingFace Spaces free tier) to avoid rebuilding Vite for every bundle.

### 4. Phase 2 Runtime is Code-Driven

**No LLM calls at play time.** All game logic is deterministic:
- Rules are already baked into RulesDSL (doc 03).
- Assets are pre-generated templated SVGs.
- The engine is a pure rule interpreter; no generative models.

This ensures fast, predictable, low-latency gameplay.

### 5. Visibility Enforcement

From design doc 02 (ECS), components have a `visibility: 'public' | 'owner' | 'none'` field. At render time:

- `'public'`: always shown to all players.
- `'owner'`: shown only when `state.current_player === component.owner`.
- `'none'`: never shown.

Example: opponent's hand is marked `visibility: 'owner'` with `owner: player_2`; it renders as a facedown stack for `player_1` but full cards for `player_2`.

---

## Trade-offs considered

| # | Decision | Rationale | Alternative | Why not |
|----|----------|-----------|-------------|---------|
| 1 | **Scope**: Backend + full Phase 2 scaffold (vs. backend + UI only) | User needed end-to-end MVP where "Open game" plays the game, not just produces bundle.json. | Backend+UI stubs | Would not ship a playable game. |
| 2 | **Real agents** (vs. deterministic stubs) | MVP delivers working games to user today. | Stubs | Stubs require later replacement; real agents prove the full pipeline works. |
| 3 | **Templated SVG** (vs. raw LLM SVG, image-gen APIs, emoji+CSS) | Consistent quality, cheap, pretty enough for MVP. | DALL-E/Stability | Slow, expensive, large bundles, overkill for MVP. |
| 4 | **Single IIFE game.js** (vs. ES modules, MF, script soup) | One file, no loader, runs anywhere (GH Pages, S3, file://). | Module bundles | Added complexity; IIFE is browser-native. |
| 5 | **Separate bundle.json fetch** (vs. embedded in game.js) | Smaller game.js; allows hot-swap of metadata without rebuild. | Embedded | Defeats cache advantage; larger artifact. |
| 6 | **Generic renderer** querying ECS (vs. per-game React code) | One engine, many games. Matches doc 02 design. | Per-game code | Defeats entire generality goal. |
| 7 | **Event log in-memory + localStorage** (vs. server-side) | MVP scope; supports replay/undo in session. | Server-side | Out of MVP scope; cross-session persistence deferred. |
| 8 | **Visibility component** (vs. no hiding, vs. cryptographic) | Matches doc 02; simplicity for MVP. | Cryptographic | Overkill; protection against *accidental* viewing only. |
| 9 | **Backend + GH Pages hosting** (vs. one or the other) | Live bundles served by backend; shareable, long-term copies on gh-pages. | Backend only | Makes sharing harder; no permanent link. |
| 10 | **Assembler caching** (vs. rebuild every time) | HuggingFace Spaces free tier has limited CPU; caching is critical. | Rebuild | Would timeout on Spaces after a few users. |
| 11 | **Single-player with current_player toggle** (vs. true multiplayer) | MVP simplicity. Engine already supports current_player for passcode model. | Network multiplayer | Post-MVP; foundation already laid. |

---

## Interfaces / data contracts

### bundle.json Schema (Zod sketch)

```typescript
type BundleData = {
  bundle_id: string;                    // e.g., "bld_abc123"
  version: string;                      // e.g., "1.0"
  dsl_version: string;                  // minimum engine version, e.g., "0.1"
  rules_dsl: RulesDSLGraph;             // from doc 03
  asset_manifest: AssetManifestEntry[];
  conflicts_resolved: ConflictResolution[];
  conflicts_unresolved_non_blocking: string[];  // e.g., ["castling not supported"]
  metadata: {
    name: string;
    description: string;
    author: string;
    created_at: ISO8601;
  };
};

type AssetManifestEntry = {
  id: string;                           // e.g., "pawn_white"
  file: string;                         // path relative to bundle, e.g., "assets/pawn_white.svg"
  role: 'board' | 'card_template' | 'resource_token' | 'player_panel' | 'token' | 'tile' | 'misc';
  svg_viewbox: string;                  // e.g., "0 0 100 100"
  attrs?: Record<string, unknown>;      // optional: template data (e.g., { color: '#fff', label: 'Knight' })
};
```

### Engine API

```typescript
interface Engine {
  dispatch(action: GameAction): void;
  getState(): GameState;                // ECS snapshot
  subscribe(listener: (state: GameState) => void): Unsubscribe;
  undo(): void;
  replay(events: ActionLog[]): void;
}

type GameAction = {
  type: string;                         // e.g., "move_piece", "play_card"
  payload?: Record<string, unknown>;
  timestamp?: number;
};

type GameState = {
  entities: Map<EntityId, Component[]>;
  current_player: PlayerId;
  phase: string;
  turn: number;
};
```

### Boot Contract (game.js IIFE)

```typescript
// Exported from the IIFE
window.BGB = {
  boot: (rootElement: HTMLElement, bundle: BundleData) => Engine;
};

// Usage in index.html or outer app:
const engine = window.BGB.boot(document.getElementById('game'), bundleData);
```

### Backend Endpoints

| Endpoint | Method | Response |
|----------|--------|----------|
| `GET /bundles/:id` | GET | Bundle metadata + URLs (bundle.json, game.js, assets/) |
| `GET /bundles/:id/bundle.json` | GET | Full bundle.json |
| `GET /bundles/:id/game.js` | GET | game.js IIFE (Content-Type: application/javascript) |
| `GET /bundles/:id/assets/*` | GET | SVG asset |
| `POST /bundles` | POST | Create new bundle (admin only) |

### Assembler Cache Key

```typescript
const cacheKey = sha256(
  JSON.stringify({
    scaffold_source_hash: hashDir('/apps/scaffold'),
    bundle_config_hash: hashFile('bundle.json'),
    asset_manifest_hash: hashFile('asset-manifest.json'),
  })
);
```

### scripts/publish-bundle.ts Contract

```typescript
await publishBundle(bundle_id: string, targetBranch?: string);
// Fetches from backend, commits to gh-pages/bundles/{id}/, pushes.
// Enables shareable, permanent URLs: https://orgname.github.io/bgb/bundles/{id}/game.js
```

---

## Worked example

**User journey: Creating and playing Chess**

1. **Builder**: User designs Chess game in the Builder UI. Agents (docs 04–05) produce:
   - RulesDSL graph for move validation, win conditions, turn order.
   - Asset manifest with references to 6 piece templates (pawn, rook, knight, bishop, queen, king) and a board.

2. **Create bundle**: User clicks "Build & Play." Backend assembler:
   - Writes `bundles/bld_chess_001/bundle.json` with RulesDSL + asset manifest.
   - Confirms SVGs are generated in `bundles/bld_chess_001/assets/`.
   - Checks cache key. Let's say it's a miss (first time).
   - Overwrites `/apps/scaffold/game/board-config.json` with an 8×8 grid (64 nodes, coordinates).
   - Overwrites `/apps/scaffold/game/asset-manifest.json` with piece + board asset refs.
   - Runs `pnpm --filter scaffold build`.
   - Copies `dist/game.js` → `bundles/bld_chess_001/game.js`.

3. **Play**: UI opens `/bundles/bld_chess_001/` in a new tab (backend serves a minimal `index.html`):
   ```html
   <html>
     <body>
       <div id="game"></div>
       <script src="game.js"></script>
       <script>
         fetch('bundle.json').then(r => r.json()).then(b => {
           window.BGB.boot(document.getElementById('game'), b);
         });
       </script>
     </body>
   </html>
   ```

4. **Engine boot**:
   - `createEngine(bundle)` reads RulesDSL.
   - ECS materializes 64 BoardNode entities, 32 piece entities, 2 Player entities.
   - Systems initialize: phase = "white_turn", current_player = player_1, turn = 1.

5. **Render**: `<Board />` queries `(BoardNode, Position, Asset)`, maps to 8×8 grid with piece SVGs.

6. **User moves pawn e2 → e4**:
   - User clicks board at e2, then e4.
   - UI calls `engine.dispatch({ type: 'move_piece', payload: { from: 'e2', to: 'e4' } })`.
   - `rule-executor` looks up the DSL action for (state.phase, 'move_piece') → finds the effect `atomic([move(entity, target_position), phase('black_turn')])`.
   - Executes: entity Position component updated, phase → 'black_turn', event logged.
   - Renderer re-subscribes, updates board.

7. **Castling attempt**: User tries to castle king. DSL marks this effect as `unsupported_effect` (doc 03) because the assembler flagged it as a known conflict. `rule-executor` rejects the action. UI shows a friendly alert: "Castling is not supported in this game engine version."

8. **Replay / undo**: User clicks "Undo." `engine.undo()` pops from event-log, re-applies prior events, renderer updates. All within the session; cross-session persistence deferred.

---

## Open questions & follow-ups

| # | Question | Status | Notes |
|----|----------|--------|-------|
| 1 | localStorage cross-session persistence? | Post-MVP | Doc 02 Q8; would require indexedDB + sync logic. |
| 2 | Real-time games / simultaneous player actions? | Out of scope | Single-player + turn-based only for MVP. |
| 3 | Image-gen hero art per bundle? | Deferred | Templated SVG sufficient for MVP; can upgrade later. |
| 4 | DSL version mismatch handling? | Locked | Engine refuses if `bundle.dsl_version > engine.dsl_version`. Warn if older. |
| 5 | Bundle signature / integrity checks? | Not in MVP | Trust the source; can add signing post-MVP. |
| 6 | Renderer accessibility (ARIA, keyboard nav)? | Basic only | Full a11y deferred; best-effort for MVP. |
| 7 | Mobile / touch support? | Best-effort | CSS-responsive; not a primary focus. |
| 8 | Embedding bundles in external sites (iframe safety)? | Post-MVP | Content-Security-Policy, sandboxing deferred. |

---

## References

- **Doc 02**: ECS design, Visibility components, component queries.
- **Doc 03**: RulesDSL syntax, Minimal-6 actions, unsupported_effect flags, conflicts.
- **Doc 04**: Rules agent output (RulesDSL graph, conflicts, resolved hints).
- **Doc 05**: Orchestrator, assembler, asset agent (SVG templates), frontend agent (board-config.json, asset-manifest.json).
- **Vite Lib Mode**: https://vitejs.dev/guide/build.html#library-mode
- **ECS Pattern**: https://en.wikipedia.org/wiki/Entity_component_system
