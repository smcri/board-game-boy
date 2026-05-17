/**
 * Test for assembler.ts gap 4 - overwrite scaffold/game/* and run build.
 * CLOSED: gap 4 - assembler test
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assembleBundle } from '../assembler.js';
import { BuildState } from '@bgb/shared';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';

describe('Assembler', () => {
  beforeEach(() => {
    // Clean up test bundles before each test
    vi.clearAllMocks();
  });

  it('should create bundle.json in the bundle directory', async () => {
    const state: BuildState = {
      bundle_id: 'test-assembler-1',
      prompt: 'Test',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'assembling',
      rules_dsl: {
        dsl_version: '1.0',
        metadata: {
          game_name: 'Test Game',
          min_players: 2,
          max_players: 4,
        },
        entities: [],
        actions: [],
        win_conditions: [],
        conflicts: [],
      },
      asset_manifest: {
        entries: [],
        palette: [],
      },
      conflicts: [],
      errors: [],
    };

    const result = await assembleBundle(state);

    // Should succeed
    expect(result.status).toBe('done');

    // bundle.json should exist
    const bundlePath = join(config.BUNDLES_DIR, state.bundle_id, 'bundle.json');
    expect(existsSync(bundlePath)).toBe(true);

    // Verify bundle.json content
    const bundleContent = readFileSync(bundlePath, 'utf-8');
    const bundle = JSON.parse(bundleContent);
    expect(bundle.bundle_id).toBe(state.bundle_id);
    expect(bundle.rules_dsl.metadata.game_name).toBe('Test Game');
  });

  it('should handle missing rules_dsl gracefully', async () => {
    const state: Partial<BuildState> = {
      bundle_id: 'test-assembler-missing',
      prompt: 'Test',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      asset_manifest: { entries: [], palette: [] },
      conflicts: [],
      errors: [],
    };

    const result = await assembleBundle(state as BuildState);

    // Should fail gracefully
    expect(result.status).toBe('error');
    expect(result.errors?.some((e) => e.includes('Missing'))).toBe(true);
  });

  it('should exclude core_mechanic conflicts from bundle', async () => {
    const state: BuildState = {
      bundle_id: 'test-assembler-conflicts',
      prompt: 'Test',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'assembling',
      rules_dsl: {
        dsl_version: '1.0',
        metadata: {
          game_name: 'Test Game',
          min_players: 2,
          max_players: 4,
        },
        entities: [],
        actions: [],
        win_conditions: [],
        conflicts: [],
      },
      asset_manifest: {
        entries: [],
        palette: [],
      },
      conflicts: [
        {
          id: 'conflict-1',
          rule: 'test-rule',
          description: 'Should be excluded',
          sources: [{ url: 'http://example.com', source_type: 'publisher' }],
          severity: 'core_mechanic',
          confidence: 1.0,
        },
        {
          id: 'conflict-2',
          rule: 'test-rule',
          description: 'Should be included',
          sources: [{ url: 'http://example.com', source_type: 'publisher' }],
          severity: 'flavor',
          confidence: 0.5,
        },
      ],
      errors: [],
    };

    const result = await assembleBundle(state);
    expect(result.status).toBe('done');

    // Check bundle.json
    const bundlePath = join(config.BUNDLES_DIR, state.bundle_id, 'bundle.json');
    const bundleContent = readFileSync(bundlePath, 'utf-8');
    const bundle = JSON.parse(bundleContent);

    // core_mechanic should not be in conflicts_unresolved_non_blocking
    expect(bundle.conflicts_unresolved_non_blocking.some((c: any) => c.severity === 'core_mechanic')).toBe(false);
    // But flavor should be
    expect(bundle.conflicts_unresolved_non_blocking.some((c: any) => c.severity === 'flavor')).toBe(true);
  });

  it('should include resolved conflicts in bundle', async () => {
    const state: BuildState = {
      bundle_id: 'test-assembler-resolved',
      prompt: 'Test',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'assembling',
      rules_dsl: {
        dsl_version: '1.0',
        metadata: {
          game_name: 'Test Game',
          min_players: 2,
          max_players: 4,
        },
        entities: [],
        actions: [],
        win_conditions: [],
        conflicts: [],
      },
      asset_manifest: {
        entries: [],
        palette: [],
      },
      conflicts: [
        {
          id: 'conflict-resolved',
          rule: 'test-rule',
          description: 'Resolved conflict',
          sources: [{ url: 'http://example.com', source_type: 'publisher' }],
          severity: 'core_mechanic',
          confidence: 1.0,
          resolution: { decision: 'accept' },
        },
      ],
      errors: [],
    };

    const result = await assembleBundle(state);
    expect(result.status).toBe('done');

    // Check bundle.json
    const bundlePath = join(config.BUNDLES_DIR, state.bundle_id, 'bundle.json');
    const bundleContent = readFileSync(bundlePath, 'utf-8');
    const bundle = JSON.parse(bundleContent);

    // Resolved conflict should be in conflicts_resolved
    expect(bundle.conflicts_resolved.some((c: any) => c.id === 'conflict-resolved')).toBe(true);
  });
});
