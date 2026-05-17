# State Model: Entity-Component-System (ECS)

## 1. Purpose & scope

This document defines the runtime state model for the Agentic Board Game Builder MVP. The model must:

- Support arbitrary board game mechanics without per-game code in the engine or renderer
- Allow AI agents to compose game state through a closed component registry
- Enforce per-component / per-entity visibility for hidden information at render time
- Enable a single generic React renderer across all games
- Remain extensible for future game concepts without modifying the engine core

The scope covers:
- The ECS architecture and entity/component lifecycle
- The closed component registry for MVP (12 component kinds)
- Visibility semantics (render-time enforcement, no cryptography)
- Generic system patterns (turn loop, phase advance)
- Query and mutation primitives used by RulesDSL and the renderer

This document does **not** cover the RulesDSL syntax (doc 03), the agent prompting strategy (doc 01), or rendering implementation (doc 06).

---

## 2. Locked decisions

### 2.1 Runtime state is Entity-Component-System (ECS)

**Decision:** The game state at runtime is organized as:
- **Entities:** Opaque integer or string IDs with no intrinsic properties
- **Components:** Typed, named attribute bags (e.g., `Identity`, `Position`, `Owner`)
- **Systems:** Stateless functions that query entities by component combination and apply primitive mutations

**Rationale:** ECS is data-oriented design. It naturally composes orthogonal concerns (e.g., "anything visible only to owner" is independent of what entity type it is). It enables one generic renderer and decouples game rules from engine structure.

### 2.2 Closed component registry for MVP

**Decision:** The MVP supports exactly these 12 component kinds. New component kinds require a separate registry change (not an agent privilege).

| Component | Purpose | Key fields |
|-----------|---------|-----------|
| `Identity` | What is this entity? | `name: string`, `kind: 'player' \| 'piece' \| 'card' \| ...` |
| `Player` | Represents a game player | `seat: number`, `current?: boolean` |
| `Owner` | Who controls this entity? | `player_entity: EntityId` |
| `Counter` | Numeric track: resource, score, clock | `key: string`, `value: number`, `min?: number`, `max?: number`, `step?: number` |
| `Position` | Where is this entity? | `on: 'board' \| 'deck' \| 'hand' \| 'region' \| 'off_board'`, `node?: EntityId`, `slot?: number` |
| `Adjacency` | Graph edges (attached to BoardNode) | `to: EntityId[]` |
| `BoardNode` | Board location / node | `kind: 'graph' \| 'grid_hex' \| 'grid_square' \| 'track' \| 'region'`, `coords?: Record<string, any>` |
| `Card` | Card template + data | `template: string`, `data: Record<string, unknown>` |
| `Deck` | Card container visibility | `visibility: 'public' \| 'owner' \| 'none'` |
| `Hand` | Player hand visibility | `visibility: 'public' \| 'owner' \| 'none'` |
| `Tile` | Named tile token | `kind: string` |
| `Token` | Named game token | `kind: string` |
| `Phase` | Attached to singleton: current game phase | `name: string` |
| `Turn` | Attached to singleton: current turn state | `current_player: EntityId` |
| `Visibility` | Override default visibility for any component | `scope: 'public' \| 'owner' \| 'none'` |
| `Meta` | Escape hatch for untyped JSON | `json: any` |

### 2.3 Per-component / per-path Visibility is enforced at render time

**Decision:** 
- Each entity's `Position`, `Card`, `Deck`, `Hand`, and other sensitive components can carry a `Visibility` component or field
- A `Visibility{scope: 'owner'}` means "only the owner player sees this"
- The renderer queries `(Entity, Owner, Visibility)` and filters results based on the active player
- No cryptographic commitment or hidden-state proofs in MVP — visibility is render-time filtering

### 2.4 Generic systems, no game-domain knowledge in the engine

**Decision:**
- `/apps/scaffold/engine/systems.ts` provides only primitive systems:
  - Turn advance (`advance_turn`)
  - Phase advance (`phase_change`)
  - Win-condition polling (not automatic; invoked by rules)
- All game-specific logic lives in RulesDSL (doc 03), executed by the Agentic Executor
- The engine does not know the rules of Chess, Ticket to Ride, or anything else

### 2.5 One generic React renderer

**Decision:**
- `/apps/scaffold/renderer/` renders all games without per-game configuration
- It queries:
  - `(BoardNode, Position)` → draws board nodes and positioned entities
  - `(Player, Counter)` → renders player panels (scores, clocks, resources)
  - `(Card, Owner, Position, Visibility)` → renders hands with filtering
  - Falls back to generic JSON panel for `Meta` components
- Layout is data-driven from component structure, not hand-coded

### 2.6 Schemas are Zod, single source of truth

**Decision:**
- All component shapes are defined in `packages/shared/ecs.ts` as Zod schemas
- Backend, scaffold engine, and React renderer all import from this module
- Validation happens at component creation and mutation

---

## 3. Trade-offs considered

Three fundamental architectures were evaluated for state organization.

### Option A: Generic dictionary (schemaless / NoSQL pattern)

**Structure:**
```javascript
{
  pieces: {
    piece_1: { name: 'white_king', x: 4, y: 0, owner: 'p1', type: 'piece' },
    piece_2: { name: 'black_pawn', x: 5, y: 6, owner: 'p2', type: 'piece' },
  },
  board: { width: 8, height: 8, grid: [...] },
  players: [ { id: 'p1', name: 'Alice' }, ... ],
}
```

**Analogy:** MongoDB documents, early Redux (untyped), DOM, Firestore.

**Pros:**
- Maximum flexibility; add any field to any entity
- Smallest engine code
- Matches agent reasoning ("I set piece.x to 5")

**Cons:**
- No enforced schema; silent path typos (`piece.positoin` vs `piece.position`)
- Renderer must be configured per-bundle or per-game to know where to find board data, hand data, scores
- No type safety; easy to corrupt state
- Queries require manual traversal and property checking
- Visibility is awkward: must be layered as a separate transform on render

**Rejected because:** The renderer cannot be generic. Each game defines its own shape, and the renderer must know per-game where the board lives, where the hands live, etc. This violates our MVP goal.

---

### Option B: Light schema with named collections (Domain model / typed relational pattern)

**Structure:**
```typescript
{
  players: [ { id, name, seat, color } ],
  pieces: [ { id, type, owner_id, position: { x, y } } ],
  board: { width, height, grid_layout },
  tracks: { score: [ ... ], clock: [ ... ] },
  decks: [ { id, cards: [...] } ],
}
```

**Analogy:** Django models, Rails ActiveRecord, GraphQL schema, DDD aggregates, OpenAPI.

**Pros:**
- Strong invariants per collection type
- Renderer can hardcode queries: `players.find(p => p.active)` for turn order, `pieces.filter(p => p.owner === activePlayer)` for owned pieces
- Schemas live in `packages/shared` and validate consistently
- Familiar pattern for backend engineers

**Cons:**
- Awkward fit for unusual gameplay concepts (e.g., Magic: The Stack, where a spell is not "in hand" or "on board" but in a special resolved/unresolved queue with ordering rules)
- Requires a escape hatch (`meta: {}` field on many entities)
- Adding a new collection type requires schema changes
- Difficult to express cross-cutting concerns: "render only things owned by active player" requires querying multiple collections and merging results
- Board shape is fixed: must support grid, graph, and region layouts explicitly; irregular boards are awkward

**Rejected because:** Some games have genuinely orthogonal concepts that don't fit named collections. Also, the per-component Visibility rule (already decided) is **adjective-shaped** ("make this component visible only to owner"), not verb-shaped ("add this piece to the owned-pieces array"). Option B forces us to push visibility back to render-time as a post-processing step, losing the declarative power we get from attaching Visibility to individual components.

---

### Option C: Pure ECS (composition over inheritance, data-oriented design) — **CHOSEN**

**Structure:**
```typescript
entities = new Map<EntityId, Map<ComponentName, ComponentData>>();

// E.g.:
entities.set('piece_1', new Map([
  ['Identity', { name: 'white_king', kind: 'king' }],
  ['Owner', { player_entity: 'p1' }],
  ['Position', { on: 'board', node: 'e1' }],
  ['Visibility', { scope: 'public' }],
]));

entities.set('p1', new Map([
  ['Player', { seat: 0, current: true }],
  ['Counter', { key: 'clock_seconds', value: 300 }],
]));
```

**Analogy:** Unity DOTS, Bevy, Apple ECS, RDF triples, CSS selectors.

**Pros:**
- **Maximum generality:** New gameplay concepts are new components, not schema changes. No escape hatches needed.
- **Orthogonal concerns:** Visibility, ownership, position are independent. Queries like `(Card, Position, Visibility)` are natural and composable.
- **One generic renderer falls out naturally:** Query `(BoardNode, Position)` to draw the board. Query `(Card, Owner, Position, Visibility)` to draw hands with filtering. The renderer is a loop: for each component combination, apply a generic rendering rule. New components = new rendering rules, not new game-specific logic.
- **Trivial cross-cutting behavior:** "Render only entities the active player owns" is a single query filter: `entities.filter(e => e.Owner?.player_entity === activePlayer && e.Visibility?.scope !== 'owner' || e.Owner?.player_entity === activePlayer)`.
- **Agent-friendly:** Agents think in terms of components naturally ("this piece has an Owner and a Position"). Prompts guide them to use the closed registry.

**Cons:**
- **More verbose agent output:** A single move is `{ op: 'update', entity: 'piece_e2', component: 'Position', data: { on: 'board', node: 'e4' } }` instead of `{ op: 'move', piece: 'e2', to: 'e4' }`.
- **LLM consistency:** The agent must produce component names from the closed registry consistently. Mitigation: schema-driven prompts (doc 01) + Zod parsing with retry-on-invalid.
- **Renderer complexity:** The renderer must handle arbitrary component combinations. Mitigation: a data-driven rule system (doc 06).

**Chosen because:** We need one engine + one renderer that handles Ticket to Ride, Chess, and MtG variants. Option C is the **only pattern** that:
1. Allows per-component Visibility (already decided)
2. Keeps the renderer generic (no per-game config)
3. Future-proofs for new gameplay concepts without engine changes

---

### 3.1 The noun-shaped vs. adjective-shaped framing

- **Option A is noun-shaped:** It organizes state by aggregate roots (the piece, the board, the player). Properties describe the noun. Layout is hierarchical.
- **Option B is noun-verb-shaped:** It organizes by named collections (players, pieces, decks) with verbs as operations (add piece, remove piece). Layout is relational.
- **Option C is adjective-shaped:** It organizes by orthogonal properties (visibility, position, ownership). Entities are just ID hooks. Layout is queryable by attribute.

ECS is "adjective-shaped" because you ask "what entities have Visibility AND Owner AND Position?" not "where does the piece live in my object hierarchy?"

---

### 3.2 Architectures not considered and why

- **Actor model:** Entities as active agents sending messages. Overkill for turn-based games; adds concurrency complexity. Inappropriate for deterministic game replay.
- **RDF triple store directly:** (Subject, Predicate, Object) as the only primitive. Too low-level; agents would emit thousands of triples. The component registry is a pragmatic middle ground.
- **Pure functional / persistent data structures:** Immutable snapshots for every mutation. Appealing for replay and undo, but breaks agent real-time reasoning about current state. Optimization for later (doc 06).
- **Blackboard pattern:** Shared mutable bulletin board for rules to post constraints and observe. Powerful but hard to reason about ordering; agents would struggle to predict side effects.

---

## 4. Interfaces / data contracts

### 4.1 Component registry (Zod-style sketch)

All schemas are defined in `packages/shared/ecs.ts`. Here are the shapes:

```typescript
// Every entity has an opaque ID
type EntityId = string | number;

// Identity: what is this?
Identity = {
  name: string;
  kind: string; // 'player', 'piece', 'card', 'token', 'board_node', 'deck', 'hand', ...
}

// Player: represents a player
Player = {
  seat: number; // 0-indexed
  current?: boolean; // true if this player's turn
}

// Owner: who controls it?
Owner = {
  player_entity: EntityId;
}

// Counter: numeric tracks (resources, scores, clocks, heat, etc.)
Counter = {
  key: string;
  value: number;
  min?: number;
  max?: number;
  step?: number; // for increments
}

// Position: where is it?
Position = {
  on: 'board' | 'deck' | 'hand' | 'region' | 'off_board';
  node?: EntityId; // if on board, which board node?
  slot?: number; // if in hand/deck, which slot/index?
}

// Adjacency: attached to BoardNode. Graph edges.
Adjacency = {
  to: EntityId[]; // entity IDs of adjacent nodes
}

// BoardNode: board location
BoardNode = {
  kind: 'graph' | 'grid_hex' | 'grid_square' | 'track' | 'region';
  coords?: Record<string, any>; // { file: 'a', rank: 1 } for chess; { q, r, s } for hex
}

// Card: a card with template + data
Card = {
  template: string; // 'card_type_spell', 'card_type_unit', etc.
  data: Record<string, unknown>; // { cost: 5, damage: 3 }
}

// Deck: a pile of cards
Deck = {
  visibility: 'public' | 'owner' | 'none';
}

// Hand: cards in a player's hand
Hand = {
  visibility: 'public' | 'owner' | 'none';
}

// Tile: a named tile
Tile = {
  kind: string; // 'forest', 'mountain', 'city', etc.
}

// Token: a named token
Token = {
  kind: string; // 'cube_red', 'meeple_blue', 'control_marker', etc.
}

// Phase: attached to a singleton entity. Current game phase.
Phase = {
  name: string; // 'white_turn', 'bidding_phase', 'action_resolution', etc.
}

// Turn: attached to a singleton entity. Current turn state.
Turn = {
  current_player: EntityId; // which player's turn?
}

// Visibility: override visibility for a component (attached to same entity as the component)
Visibility = {
  scope: 'public' | 'owner' | 'none';
}

// Meta: escape hatch for untyped JSON
Meta = {
  json: any;
}
```

### 4.2 Query patterns

Queries are issued by the renderer and systems. Syntax (pseudocode):

```typescript
// Find all pieces owned by player 'p1' that are on the board
query(Piece, Owner, Position).where(
  (e) => e.Owner?.player_entity === 'p1' && e.Position?.on === 'board'
);

// Find all board nodes adjacent to a given node
query(BoardNode, Adjacency).where((e) => e.Adjacency?.to.includes(targetNode));

// Find all entities visible to the active player
query(Visibility).where(
  (e) => e.Visibility?.scope === 'public' || e.Owner?.player_entity === activePlayer
);

// Find player with current turn
query(Player, Turn).where((e) => e.Turn?.current_player === e.id);
```

Implementation: `/apps/scaffold/engine/query.ts` provides typed query helpers.

### 4.3 RulesDSL declaration of initial entities

The RulesDSL (doc 03) declares the game's initial state as:

```
ENTITIES:
  board:
    - node(id: 'a1', kind: 'grid_square', coords: { file: 'a', rank: 1 })
      adjacent_to: ['a2', 'b1', 'b2']
    - node(id: 'e1', kind: 'grid_square', coords: { file: 'e', rank: 1 })
      has: [white_king]
  
  pieces:
    - piece(id: 'white_king', kind: 'king', owner: 'p1', on: 'board' at 'e1', visibility: 'public')
  
  players:
    - player(id: 'p1', seat: 0, counter: { key: 'clock_seconds', value: 600 })

  singletons:
    - phase(name: 'white_turn')
    - turn(current_player: 'p1')
```

This is translated by the RulesDSL parser into `engine.createEntity()` and `engine.attachComponent()` calls.

### 4.4 Visibility semantics

Visibility is checked at **render time**:

1. The renderer queries `(Entity, Position, Card, Hand, Deck, Visibility)` (for sensitive components)
2. For each entity, it checks:
   - If the entity has a `Visibility` component with scope `'owner'`, include it **only if** `entity.Owner?.player_entity === activePlayer`
   - If scope `'public'`, always include
   - If scope `'none'`, never include
3. If no `Visibility` component, use the parent component's default (e.g., `Deck.visibility`)

Example: a face-down card in player 1's hand:
```typescript
{
  id: 'card_7',
  Card: { template: 'spell', data: {...} },
  Owner: { player_entity: 'p1' },
  Position: { on: 'hand', slot: 0 },
  Visibility: { scope: 'owner' }, // only p1 sees this
}
```

When rendering for player 1: visible.
When rendering for player 2: position and identity hidden; shown as a generic "back of card".
When rendering for spectator: all hands hidden per `Hand.visibility: 'none'`.

### 4.5 File layout

```
/apps/scaffold/
├── engine/
│   ├── ecs.ts                 # Core ECS implementation
│   ├── query.ts               # Query helpers
│   ├── systems.ts             # Primitive systems (advance_turn, phase_change)
│   └── executor.ts            # Executes RulesDSL blocks
├── renderer/
│   ├── Board.tsx              # Renders BoardNode + Position
│   ├── PlayerPanel.tsx        # Renders Player + Counter
│   ├── Hands.tsx              # Renders Card + Owner + Position + Visibility
│   ├── GenericDebugPanel.tsx  # Renders Meta
│   └── rules.ts               # Data-driven rendering rules (doc 06)
└── types.ts                   # Re-exports from packages/shared/ecs.ts

/packages/shared/
└── ecs.ts                     # Single source of truth: Zod schemas for all components
```

---

## 5. Worked example: Chess

A minimal Chess setup in ECS:

### 5.1 Board entities (64 nodes)

```typescript
// One entity per square
for (let rank = 1; rank <= 8; rank++) {
  for (let file = 'a'.charCodeAt(0); file <= 'h'.charCodeAt(0); file++) {
    const fileChar = String.fromCharCode(file);
    const nodeId = `${fileChar}${rank}`;
    
    engine.createEntity(nodeId, [
      { type: 'Identity', data: { name: nodeId, kind: 'board_node' } },
      { type: 'BoardNode', data: { kind: 'grid_square', coords: { file: fileChar, rank } } },
      { type: 'Adjacency', data: { to: [...adjacent squares...] } },
    ]);
  }
}
```

### 5.2 Piece entities (32 pieces)

```typescript
const pieces = [
  { id: 'white_king', kind: 'king', owner: 'p1', node: 'e1' },
  { id: 'white_queen', kind: 'queen', owner: 'p1', node: 'd1' },
  { id: 'white_pawn_a2', kind: 'pawn', owner: 'p1', node: 'a2' },
  // ... and 29 more
  { id: 'black_king', kind: 'king', owner: 'p2', node: 'e8' },
  // ... and 15 more black pieces
];

pieces.forEach(p => {
  engine.createEntity(p.id, [
    { type: 'Identity', data: { name: p.id, kind: p.kind } },
    { type: 'Owner', data: { player_entity: p.owner } },
    { type: 'Position', data: { on: 'board', node: p.node } },
    { type: 'Visibility', data: { scope: 'public' } },
  ]);
});
```

### 5.3 Player entities

```typescript
engine.createEntity('p1', [
  { type: 'Identity', data: { name: 'Player 1', kind: 'player' } },
  { type: 'Player', data: { seat: 0, current: true } },
  { type: 'Counter', data: { key: 'clock_seconds', value: 600, min: 0 } },
]);

engine.createEntity('p2', [
  { type: 'Identity', data: { name: 'Player 2', kind: 'player' } },
  { type: 'Player', data: { seat: 1, current: false } },
  { type: 'Counter', data: { key: 'clock_seconds', value: 600, min: 0 } },
]);
```

### 5.4 Singletons

```typescript
engine.createEntity('phase_singleton', [
  { type: 'Phase', data: { name: 'white_turn' } },
]);

engine.createEntity('turn_singleton', [
  { type: 'Turn', data: { current_player: 'p1' } },
]);
```

### 5.5 A move: e2 to e4

Represented as a RulesDSL action (doc 03):

```
DO:
  move(piece: 'white_pawn_e2', to: 'e4')
THEN:
  phase('black_turn')
```

In ECS mutations:

```typescript
// Step 1: Update the pawn's position
engine.updateComponent('white_pawn_e2', 'Position', {
  on: 'board',
  node: 'e4',
});

// Step 2: Update the turn
engine.updateComponent('turn_singleton', 'Turn', {
  current_player: 'p2',
});

// Step 3: Update the phase
engine.updateComponent('phase_singleton', 'Phase', {
  name: 'black_turn',
});

// Step 4: Decrement the clock (if time control is active)
const p1_clock = engine.getComponent('p1', 'Counter');
engine.updateComponent('p1', 'Counter', {
  ...p1_clock,
  value: p1_clock.value - elapsed_seconds,
});
```

---

## 6. Open questions & follow-ups

1. **Component extensibility:** Should the registry be extensible per-bundle via `Components.declare(name, zod_schema)`, or remain closed for MVP? Currently closed. If extensible, the agent's prompt would allow `declare_component(...)` as a first-class operation, and the renderer would need a fallback rule (render as generic JSON panel).

2. **Renderer fallback for Meta:** How should the renderer handle entities with untyped `Meta` data? MVP: render as a collapsible JSON tree in a debug panel. Future: per-bundle custom renderers.

3. **Performance & indexing:** For large games (Terraforming Mars ~200 cards, splayed in hands and decks), naive `O(n)` iteration over all entities per query is acceptable for MVP. Future: implement a component index: `Map<componentName, Map<entityId, data>>` for `O(1)` lookup. Query filter still `O(n)` in worst case, but component lookup is fast.

4. **Referential integrity:** Zod cannot enforce that `Owner.player_entity` points to an existing entity. Solution: validate on engine boot with a `validateReferentialIntegrity()` pass that checks all foreign-key-like references.

5. **Ordering:** Some games require stable entity iteration order (e.g., "resolve effects in the order entities were created"). Solution: maintain a `creationOrder: EntityId[]` array alongside the entity map.

6. **Snapshot / replay:** Should we serialize the entire ECS state as JSON for replay and undo? Yes, but this is a doc 06 concern (implementation of the executor's history buffer).

---

## 7. References

- **Doc 01:** Agent prompting strategy and examples. Covers how the agent is steered to produce valid component combinations.
- **Doc 03:** RulesDSL syntax and semantics. Covers the verbs that mutate the ECS (move, create, delete, update_component, phase, etc.).
- **Doc 06:** Rendering architecture and data-driven rule system. Covers how the renderer interprets the ECS state and layouts game boards.

---

**Version:** 0.1 (MVP)  
**Status:** Locked for MVP implementation  
**Last updated:** 2026-05-17
