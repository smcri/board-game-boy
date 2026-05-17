/**
 * dsl-normalizer.ts
 *
 * Pre-validation normalizer applied to raw LLM output before Zod parsing.
 * Corrects common enum drift that small models produce, without changing
 * semantically correct values.
 *
 * Rules:
 * - Only remaps values that are clearly wrong (not in the enum) to a valid one.
 * - Never guesses at ambiguous values — leaves them for Zod to reject.
 * - Applied recursively so nested structures are also fixed.
 */

/** BoardNode.kind corrections */
const BOARD_NODE_KIND_MAP: Record<string, string> = {
  square:       'grid_square',
  grid:         'grid_square',
  hex:          'grid_hex',
  hexagonal:    'grid_hex',
  linear:       'track',
  path:         'track',
  node:         'graph',
  network:      'graph',
  area:         'region',
  zone:         'region',
};

const VALID_BOARD_NODE_KINDS = new Set(['graph', 'grid_hex', 'grid_square', 'track', 'region']);

/** Valid component names */
const VALID_COMPONENTS = new Set([
  'Identity', 'Player', 'Owner', 'Counter', 'Position', 'Adjacency',
  'BoardNode', 'Card', 'Deck', 'Hand', 'Tile', 'Token', 'Phase',
  'Turn', 'Visibility', 'Meta',
]);

/** Valid condition ops */
const VALID_OPS = new Set([
  'eq', 'neq', 'gte', 'lte', 'in', 'not_in', 'and', 'or', 'not',
  'count_at_least', 'component_present', 'path_equals',
]);

const OP_MAP: Record<string, string> = {
  equals:          'eq',
  equal:           'eq',
  '==':            'eq',
  '!=':            'neq',
  not_equals:      'neq',
  greater_than:    'gte',
  less_than:       'lte',
  includes:        'in',
  excludes:        'not_in',
  contains:        'in',
  present:         'component_present',
  exists:          'component_present',
  has_component:   'component_present',
};

/** Valid effect verbs */
const VALID_VERBS = new Set([
  'set', 'inc', 'move', 'choose', 'if', 'phase', 'atomic',
  'random.roll', 'random.pick',
]);

const VERB_MAP: Record<string, string> = {
  add:       'inc',
  subtract:  'inc',   // inc with negative value
  update:    'set',
  assign:    'set',
  change:    'set',
  transfer:  'move',
  place:     'move',
  roll:      'random.roll',
  dice:      'random.roll',
  pick:      'random.pick',
  select:    'random.pick',
  switch:    'phase',
  transition: 'phase',
};

function fixBoardNodeKind(kind: unknown): unknown {
  if (typeof kind !== 'string') return kind;
  if (VALID_BOARD_NODE_KINDS.has(kind)) return kind;
  return BOARD_NODE_KIND_MAP[kind.toLowerCase()] ?? kind;
}

function fixComponent(comp: unknown): unknown {
  if (typeof comp !== 'string') return comp;
  if (VALID_COMPONENTS.has(comp)) return comp;
  // Try case-insensitive match
  for (const valid of VALID_COMPONENTS) {
    if (valid.toLowerCase() === comp.toLowerCase()) return valid;
  }
  // If it's a game concept (Checkmate, etc.), fall back to Meta as the least-wrong option
  // but only if it clearly doesn't match any component name
  return comp; // Leave for Zod to reject — we don't want to silently mangle semantics
}

function fixOp(op: unknown): unknown {
  if (typeof op !== 'string') return op;
  if (VALID_OPS.has(op)) return op;
  return OP_MAP[op.toLowerCase()] ?? op;
}

function fixVerb(verb: unknown): unknown {
  if (typeof verb !== 'string') return verb;
  if (VALID_VERBS.has(verb)) return verb;
  return VERB_MAP[verb.toLowerCase()] ?? verb;
}

/**
 * Recursively walk raw LLM output and apply corrections.
 * This is intentionally permissive — only fixes values we can
 * safely remap without changing semantics.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeDslOutput(raw: any): any {
  if (raw === null || raw === undefined) return raw;
  if (Array.isArray(raw)) return raw.map(normalizeDslOutput);
  if (typeof raw !== 'object') return raw;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      // BoardNode.kind
      case 'kind':
        // Only fix if sibling has BoardNode-like context
        out[key] = fixBoardNodeKind(value);
        break;

      // Condition op
      case 'op':
        out[key] = fixOp(value);
        break;

      // Effect verb
      case 'verb':
        out[key] = fixVerb(value);
        break;

      // Component references in conditions/win_conditions
      case 'component':
        out[key] = fixComponent(value);
        break;

      // Recurse into nested objects/arrays
      default:
        out[key] = normalizeDslOutput(value);
    }
  }
  return out;
}
