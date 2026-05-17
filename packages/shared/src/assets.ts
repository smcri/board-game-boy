// Asset manifest schemas. See doc 06.

import { z } from 'zod';

export const AssetRole = z.enum([
  'board',
  'card_template',
  'resource_token',
  'player_panel',
  'token',
  'tile',
  'misc',
]);
export type AssetRole = z.infer<typeof AssetRole>;

export const AssetEntry = z.object({
  id: z.string().min(1),
  /** Relative file path inside the bundle's `assets/` dir. */
  file: z.string().min(1),
  role: AssetRole,
  svg_viewbox: z.string().min(1), // e.g. "0 0 100 100"
  attrs: z.record(z.string(), z.unknown()).optional(),
});
export type AssetEntry = z.infer<typeof AssetEntry>;

export const AssetManifest = z.object({
  palette: z.array(z.string().regex(/^#?[0-9A-Fa-f]{3,8}$/)).default([]),
  entries: z.array(AssetEntry).default([]),
});
export type AssetManifest = z.infer<typeof AssetManifest>;
