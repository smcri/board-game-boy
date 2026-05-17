# Scaffold Renderer

A React-based game board renderer that supports multiple board layouts and game state visualization.

## Supported Board Kinds

### grid_square
A traditional square grid board (e.g., Tic-Tac-Toe, Chess).

**Node format:**
```json
{
  "id": "square_0_0",
  "coords": { "file": 0, "rank": 0 }
}
```

**Features:**
- Renders as a grid of squares
- Supports up to 10×10 grids (400×400 SVG)
- Entities positioned via `Position.node` render as blue circles

---

### grid_hex
An axial-coordinate hexagonal grid (e.g., Catan, HeroScape).

**Node format:**
```json
{
  "id": "hex_0_0",
  "coords": { "q": 0, "r": 0 }
}
```

**Layout:** Flat-top hexagons using axial coordinates:
- `x = sqrt(3) * size * (q + r/2)`
- `y = 1.5 * size * r`

**Features:**
- Renders hexagons as SVG `<polygon>` elements
- Automatically scales and centers based on node bounds
- Supports tokens/tiles at hex centres

---

### graph
A generic node-link directed graph (e.g., network maps, decision trees).

**Node format (explicit coords):**
```json
{
  "id": "node_a",
  "coords": { "x": 50, "y": 50 },
  "neighbours": ["node_b", "node_c"]
}
```

**Node format (auto layout):**
```json
{
  "id": "node_a",
  "neighbours": ["node_b"]
}
```

**Features:**
- If `coords` provided, uses explicit pixel positions
- If `coords` absent, applies deterministic circular layout
- Edges rendered as `<line>` elements between node centres
- Supports arbitrary topology

---

### track
A linear or circular track (e.g., board game tracks, race courses).

**Node format:**
```json
{
  "id": "track_0"
}
```

**render_hints:**
```json
{
  "shape": "circle"  // omit or use "linear" for row layout
}
```

**Features:**
- Linear layout (default): nodes in a horizontal row
- Circular layout: nodes arranged in a circle
- Tokens render stacked above nodes (slot-aware)
- Each node is a small circle

---

### region_map
Unstyled region polygons (e.g., Risk board, geography maps).

**Node format:**
```json
{
  "id": "node_0"
}
```

**BoardConfig.regions:**
```json
[
  { "id": "north", "nodes": ["node_0", "node_1"] },
  { "id": "south", "nodes": ["node_2", "node_3"] }
]
```

**render_hints (optional):**
```json
{
  "region_paths": {
    "north": "M 10 10 L 50 10 L 50 50 Z",
    "south": "M 10 50 L 50 50 L 50 90 Z"
  }
}
```

**Features:**
- If `render_hints.region_paths` provided, renders SVG `<path>` elements
- If absent, renders regions as flat-coloured rectangles in a horizontal strip with labels
- Tokens positioned at region centroid or slot-aware grid

---

## Visibility & Entity Rendering

All board kinds respect the visibility contract (doc 02):
- **Visibility.scope === 'public'**: always render
- **Visibility.scope === 'none'**: never render
- **Visibility.scope === 'owner'**: render only when `Owner.player_entity === currentPlayer`
- **Position.on !== 'board'**: never render on board (hand/deck cards excluded)

## Architecture

The renderer is split into:
- `Board.tsx` — dispatcher (main entry point)
- `board-kinds/square.tsx` — grid_square renderer
- `board-kinds/hex.tsx` — grid_hex renderer
- `board-kinds/graph.tsx` — graph renderer
- `board-kinds/track.tsx` — track renderer
- `board-kinds/region.tsx` — region_map renderer

Each sub-renderer is self-contained, < 300 lines, and uses only SVG (no canvas, no D3).

## Bundle Size

Production IIFE build:
- **game.iife.js**: ~557 KB
- **Gzipped**: ~168 KB

All four new board kinds add < 20 KB (uncompressed) due to minimal dependencies.

## Testing

Run tests with:
```bash
pnpm --filter @bgb/scaffold exec vitest run
```

Tests cover:
- grid_square rendering (9 squares)
- Player panel assertions
- Action bar rendering
- grid_hex rendering (polygon detection)
- graph rendering (circle/line detection)
- track rendering (node layout)
- region_map rendering (rect/text detection)

All 26 tests passing.
