/**
 * Test for HITL conditional edge on core_mechanic conflicts.
 * CLOSED: gap 2 - HITL interrupt test
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock classify and rules agents so they don't overwrite the test-seeded
// conflicts / rules_dsl. The HITL behaviour we want to verify lives in the
// conflict_review node + the conditional edge in graph.ts.
vi.mock('../agents/classify.js', () => ({
  classifyAgent: vi.fn(async (state: any) => ({ mode: state.mode })),
}));
vi.mock('../agents/rules.js', () => ({
  rulesAgent: vi.fn(async (state: any) => ({
    rules_dsl: state.rules_dsl ?? {
      dsl_version: '1.0',
      metadata: { game_name: 'Test Game', min_players: 2, max_players: 4 },
      entities: [],
      actions: [],
      win_conditions: [{ id: 'wc', description: 'first to ten', when: { op: 'gte', path: 'meta.x', value: 10 } }],
      conflicts: [],
    },
    // Preserve the test-seeded conflicts rather than wiping them.
    conflicts: state.conflicts ?? [],
  })),
}));

import { createGraph } from '../graph.js';
import { BuildState, Conflict, RulesDsl } from '@bgb/shared';
import { getSseEmitter } from '../sse.js';
import { _resetDbForTests } from '../db.js';

class MockLLM {
  async invoke(_messages: unknown[]): Promise<RulesDsl> {
    return {
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
    };
  }

  withStructuredOutput(schema: unknown, _opts: { name: string }): MockLLM {
    return this;
  }
}

describe('HITL Interrupt on Core Mechanic Conflicts', () => {
  beforeEach(() => {
    _resetDbForTests();
  });

  it('should halt graph execution when core_mechanic conflict detected', async () => {
    const mockLlm = new MockLLM();
    const graph = createGraph(mockLlm as any, 'test-thread-1');

    // Create a state with a core_mechanic conflict
    const coreConflict: Conflict = {
      id: 'conflict-1',
      rule: 'test-rule',
      description: 'Critical game mechanic issue',
      sources: [{ url: 'http://example.com', source_type: 'publisher' }],
      severity: 'core_mechanic',
      confidence: 1.0,
    };

    const initialState: BuildState = {
      bundle_id: 'test-bundle-hitl',
      prompt: 'Test game with conflict',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'classifying',
      conflicts: [coreConflict],
      errors: [],
    };

    const emitter = getSseEmitter(initialState.bundle_id);
    const events: any[] = [];
    emitter.on('event', (e) => {
      events.push(e);
    });

    // Run the graph; it should halt at conflict_review
    const finalState = await graph.invoke(initialState, {
      configurable: { thread_id: 'test-thread-1' },
    });

    // Assert graph halted with status='awaiting_review'
    expect(finalState.status).toBe('awaiting_review');

    // Verify interrupt event was emitted
    const interruptEvent = events.find((e) => e.type === 'interrupt');
    expect(interruptEvent).toBeDefined();
    expect(interruptEvent?.conflicts).toContainEqual(expect.objectContaining({ severity: 'core_mechanic' }));
  });

  it('should continue past conflict_review if no core_mechanic conflicts', async () => {
    const mockLlm = new MockLLM();
    const graph = createGraph(mockLlm as any, 'test-thread-2');

    // Create a state with only non-core conflicts
    const nonCoreConflict: Conflict = {
      id: 'conflict-2',
      rule: 'test-rule',
      description: 'Minor issue',
      sources: [{ url: 'http://example.com', source_type: 'publisher' }],
      severity: 'flavor',
      confidence: 0.5,
    };

    const initialState: BuildState = {
      bundle_id: 'test-bundle-no-hitl',
      prompt: 'Test game without core conflict',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'classifying',
      conflicts: [nonCoreConflict],
      errors: [],
    };

    const emitter = getSseEmitter(initialState.bundle_id);
    const events: any[] = [];
    emitter.on('event', (e) => {
      if (e.type === 'update' && e.node) {
        events.push(e.node);
      }
    });

    // Run the graph; it should proceed past conflict_review
    const finalState = await graph.invoke(initialState, {
      configurable: { thread_id: 'test-thread-2' },
    });

    // Graph should reach assembler and finish
    expect(finalState.status).toBe('done');

    // Verify graph proceeded past conflict_review
    const nodeNames = [...new Set(events)];
    expect(nodeNames).toContain('asset_agent');
  });

  it('should allow resuming after HITL decision', async () => {
    // This simulates the resume flow: graph halts, user provides decision,
    // state is updated with user_decision, and graph is re-invoked
    const mockLlm = new MockLLM();

    const coreConflict: Conflict = {
      id: 'conflict-3',
      rule: 'test-rule',
      description: 'Critical issue',
      sources: [{ url: 'http://example.com', source_type: 'publisher' }],
      severity: 'core_mechanic',
      confidence: 1.0,
    };

    const initialState: BuildState = {
      bundle_id: 'test-bundle-resume',
      prompt: 'Test game with resumable conflict',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'classifying',
      conflicts: [coreConflict],
      errors: [],
    };

    // First invocation: should halt
    const graph1 = createGraph(mockLlm as any, 'test-thread-3');
    const haltedState = await graph1.invoke(initialState, {
      configurable: { thread_id: 'test-thread-3' },
    });
    expect(haltedState.status).toBe('awaiting_review');

    // Simulate user decision
    const resumedState: BuildState = {
      ...haltedState,
      user_decision: {
        'conflict-3': 'accept',
      },
      conflicts: [
        {
          ...coreConflict,
          resolution: { decision: 'accept' },
        },
      ],
    };

    // Second invocation: should continue
    const graph2 = createGraph(mockLlm as any, 'test-thread-3-resume');
    const finalState = await graph2.invoke(resumedState, {
      configurable: { thread_id: 'test-thread-3-resume' },
    });

    // After decision and resumption, should reach done
    expect(finalState.status).toBe('done');
  });
});
