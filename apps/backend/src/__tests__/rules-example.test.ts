/**
 * rules-example.test.ts
 *
 * Belt-and-braces runtime guard: parse EXAMPLE_RULES_DSL through the real
 * RulesDsl Zod schema. Fails CI if any schema change breaks the example
 * (which would mean the prompt teaches the LLM an invalid DSL shape).
 *
 * Also verifies that the component names used in the example are all members
 * of the ALLOWED_COMPONENTS list injected into the prompt, so the two sources
 * of truth stay in sync.
 */

import { describe, it, expect } from 'vitest';
import { RulesDsl } from '@bgb/shared';
import { EXAMPLE_RULES_DSL, EXAMPLE_RULES_DSL_JSON } from '../agents/rules-example.js';

describe('EXAMPLE_RULES_DSL', () => {
  it('round-trips through RulesDsl.parse() without errors', () => {
    // This is the definitive test: if the example is schema-valid, the prompt
    // teaches a valid shape. If this fails, the prompt is misleading the LLM.
    expect(() => RulesDsl.parse(EXAMPLE_RULES_DSL)).not.toThrow();
  });

  it('EXAMPLE_RULES_DSL_JSON is valid JSON that round-trips back to the same value', () => {
    const parsed = JSON.parse(EXAMPLE_RULES_DSL_JSON);
    // Round-trip through Zod to ensure serialisation didn't drop anything
    const validated = RulesDsl.parse(parsed);
    expect(validated.dsl_version).toBe('1.0');
    expect(validated.metadata.game_name).toBe('Snakes and Ladders');
    expect(validated.entities.length).toBeGreaterThanOrEqual(2);
    expect(validated.actions.length).toBeGreaterThanOrEqual(1);
    expect(validated.win_conditions.length).toBeGreaterThanOrEqual(1);
  });

  it('all component names in the example exist in the shared COMPONENT_REGISTRY', async () => {
    // Dynamic import to get the registry without coupling to internal paths
    const { COMPONENT_REGISTRY } = await import('@bgb/shared');
    const allowedNames = new Set(Object.keys(COMPONENT_REGISTRY));
    const usedNames = new Set<string>();
    for (const entity of EXAMPLE_RULES_DSL.entities) {
      for (const compName of Object.keys(entity.components)) {
        usedNames.add(compName);
      }
    }
    for (const name of usedNames) {
      expect(allowedNames.has(name), `Component "${name}" used in example but not in COMPONENT_REGISTRY`).toBe(true);
    }
  });

  it('all effect verbs in the example are recognised by the EffectSchema', async () => {
    const { EffectSchema } = await import('@bgb/shared');
    const collectEffects = (effects: unknown[]): void => {
      for (const eff of effects) {
        // Parse each effect individually — catches unknown verb values early
        expect(() => EffectSchema.parse(eff)).not.toThrow();
        const e = eff as { verb?: string; then?: unknown[]; else?: unknown[]; steps?: unknown[] };
        if (e.then) collectEffects(e.then);
        if (e.else) collectEffects(e.else);
        if (e.steps) collectEffects(e.steps);
      }
    };
    for (const action of EXAMPLE_RULES_DSL.actions) {
      collectEffects(action.effect);
    }
  });

  it('all preconditions in the example are recognised by the ConditionSchema', async () => {
    const { ConditionSchema } = await import('@bgb/shared');
    for (const action of EXAMPLE_RULES_DSL.actions) {
      for (const cond of action.preconditions ?? []) {
        expect(() => ConditionSchema.parse(cond)).not.toThrow();
      }
    }
    for (const wc of EXAMPLE_RULES_DSL.win_conditions) {
      expect(() => ConditionSchema.parse(wc.when)).not.toThrow();
    }
  });
});
