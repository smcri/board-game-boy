/**
 * Integration test for the build graph.
 * Runs a synthetic build with stubbed LLM to verify SSE event sequence.
 */
import { describe, it, expect, vi } from 'vitest';
import { createGraph } from '../graph.js';
import { BuildState, RulesDsl, EntityDecl } from '@bgb/shared';
import { getSseEmitter } from '../sse.js';

/**
 * Mock LLM that returns a minimal valid RulesDsl.
 */
class MockLLM {
  async invoke(_messages: unknown[]): Promise<RulesDsl> {
    return {
      dsl_version: '1.0',
      metadata: {
        game_name: 'Test Game',
        min_players: 2,
        max_players: 4,
      },
      entities: [
        {
          id: 'board',
          components: {
            Identity: { name: 'Board', kind: 'board' },
            BoardNode: { kind: 'graph' },
          },
        },
        {
          id: 'player1',
          components: {
            Identity: { name: 'Player 1', kind: 'player' },
            Player: { seat: 0, current: true },
          },
        },
      ] as EntityDecl[],
      actions: [
        {
          id: 'move_piece',
          name: 'Move Piece',
          effect: [
            {
              verb: 'move',
              entity: { kind: 'entity', id: 'player1' },
              to: { on: 'board' },
            },
          ],
        },
      ],
      win_conditions: [
        {
          id: 'first_to_point',
          description: 'First player to reach 10 points wins',
          when: {
            op: 'gte',
            path: 'player.Counter.points',
            value: 10,
          },
        },
      ],
      conflicts: [],
    };
  }

  withStructuredOutput(schema: unknown, _opts: { name: string }): MockLLM {
    return this;
  }
}

describe('Build Graph', () => {
  it('should execute a minimal build flow', async () => {
    const mockLlm = new MockLLM();
    const graph = createGraph(mockLlm as any);

    const initialState: BuildState = {
      bundle_id: 'test-bundle',
      prompt: 'Create a simple chess game',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'classifying',
      conflicts: [],
      errors: [],
    };

    // Collect SSE events
    const emitter = getSseEmitter(initialState.bundle_id);
    const events: any[] = [];
    emitter.on('event', (e) => {
      events.push(e);
    });

    // Run the graph
    const finalState = await graph.invoke(initialState, { configurable: { thread_id: initialState.bundle_id } });

    expect(finalState.bundle_id).toBe('test-bundle');
    expect(finalState.rules_dsl).toBeDefined();
    expect(finalState.rules_dsl?.metadata.game_name).toBe('Test Game');

    // Verify SSE event types were emitted
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('update');
  });

  it('should handle errors gracefully', async () => {
    class FailingLLM {
      async invoke(_messages: unknown[]): Promise<never> {
        throw new Error('LLM call failed');
      }

      withStructuredOutput(schema: unknown, _opts: { name: string }): FailingLLM {
        return this;
      }
    }

    const failingLlm = new FailingLLM();
    const graph = createGraph(failingLlm as any);

    const initialState: BuildState = {
      bundle_id: 'test-bundle-error',
      prompt: 'Test prompt',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'classifying',
      conflicts: [],
      errors: [],
    };

    // Run should complete but with error status
    try {
      await graph.invoke(initialState, { configurable: { thread_id: initialState.bundle_id } });
    } catch {
      // Expected to throw
    }

    // Verify error was recorded
    const emitter = getSseEmitter(initialState.bundle_id);
    const buffer = emitter.getBuffer();
    const errorEvent = buffer.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
  });

  it('should transition through expected node sequence', async () => {
    const mockLlm = new MockLLM();
    const graph = createGraph(mockLlm as any);

    const initialState: BuildState = {
      bundle_id: 'test-bundle-sequence',
      prompt: 'Test game',
      mode: 'fully_custom',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      status: 'classifying',
      conflicts: [],
      errors: [],
    };

    const emitter = getSseEmitter(initialState.bundle_id);
    const events: any[] = [];
    emitter.on('event', (e) => {
      if (e.type === 'update' && e.node) {
        events.push(e.node);
      }
    });

    await graph.invoke(initialState, { configurable: { thread_id: initialState.bundle_id } });

    // Verify expected node sequence
    const nodeSequence = [...new Set(events)]; // Remove duplicates
    expect(nodeSequence[0]).toBe('classify');
  });
});
