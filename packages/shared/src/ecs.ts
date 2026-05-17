// Closed ECS component registry (MVP). See docs/design/02-state-model-ecs.md.
// Entities are opaque IDs. Components are typed attribute bags attached to entities.

import { z } from 'zod';

export const EntityId = z.string().min(1).max(128);
export type EntityId = z.infer<typeof EntityId>;

export const VisibilityScope = z.enum(['public', 'owner', 'none']);
export type VisibilityScope = z.infer<typeof VisibilityScope>;

// ── Component shapes (each component is a Zod object) ────────────────────────

export const C_Identity = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
});

export const C_Player = z.object({
  seat: z.number().int().nonnegative(),
  current: z.boolean().optional(),
});

export const C_Owner = z.object({
  player_entity: EntityId,
});

export const C_Counter = z.object({
  key: z.string().min(1),
  value: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

export const PositionAttach = z.enum(['board', 'deck', 'hand', 'region', 'off_board']);
export const C_Position = z.object({
  on: PositionAttach,
  node: EntityId.optional(),
  slot: z.number().int().nonnegative().optional(),
});

export const C_Adjacency = z.object({
  to: z.array(EntityId),
});

export const BoardNodeKind = z.enum(['graph', 'grid_hex', 'grid_square', 'track', 'region']);
export const C_BoardNode = z.object({
  kind: BoardNodeKind,
  // Optional topology hints — used by the assembler to generate board_config.nodes.
  // For grid_square: cols × rows grid (default 8×8).
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  // For track: number of spaces (default 100).
  spaces: z.number().int().positive().optional(),
  // For grid_hex: hex radius (default 5).
  radius: z.number().int().positive().optional(),
  // Generic coords bag (used by explicit node entities if LLM generates them).
  coords: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

export const C_Card = z.object({
  template: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export const C_Deck = z.object({
  visibility: VisibilityScope,
});

export const C_Hand = z.object({
  visibility: VisibilityScope,
});

export const C_Tile = z.object({
  kind: z.string().min(1),
});

export const C_Token = z.object({
  kind: z.string().min(1),
});

export const C_Phase = z.object({
  name: z.string().min(1),
});

export const C_Turn = z.object({
  current_player: EntityId,
});

export const C_Visibility = z.object({
  scope: VisibilityScope,
});

export const C_Meta = z.object({
  json: z.unknown(),
});

// ── Registry: name → schema ───────────────────────────────────────────────────

/** Closed component registry for the MVP. Extending it is a registry change. */
export const COMPONENT_REGISTRY = {
  Identity: C_Identity,
  Player: C_Player,
  Owner: C_Owner,
  Counter: C_Counter,
  Position: C_Position,
  Adjacency: C_Adjacency,
  BoardNode: C_BoardNode,
  Card: C_Card,
  Deck: C_Deck,
  Hand: C_Hand,
  Tile: C_Tile,
  Token: C_Token,
  Phase: C_Phase,
  Turn: C_Turn,
  Visibility: C_Visibility,
  Meta: C_Meta,
} as const;

export const ComponentName = z.enum(
  Object.keys(COMPONENT_REGISTRY) as [keyof typeof COMPONENT_REGISTRY, ...string[]],
);
export type ComponentName = keyof typeof COMPONENT_REGISTRY;

/**
 * EntityDecl is what the rules agent emits to seed the engine: an entity ID
 * plus a map of component-name → component-data. Each component value is
 * validated against the registry at boot time.
 */
export const EntityDecl = z
  .object({
    id: EntityId,
    components: z.record(ComponentName, z.unknown()),
  })
  .superRefine((decl, ctx) => {
    for (const [name, data] of Object.entries(decl.components)) {
      const schema = COMPONENT_REGISTRY[name as ComponentName];
      if (!schema) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown component "${name}"`,
          path: ['components', name],
        });
        continue;
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid data for component "${name}": ${parsed.error.message}`,
          path: ['components', name],
        });
      }
    }
  });
export type EntityDecl = z.infer<typeof EntityDecl>;
