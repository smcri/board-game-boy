/**
 * Test for /builds/:id/resume endpoint.
 * CLOSED: gap 3 - resume endpoint test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../server.js';
import { _resetDbForTests } from '../db.js';

// Mock the LLM creation
vi.mock('../llm.js', () => ({
  makeLlm: vi.fn().mockResolvedValue({
    invoke: vi.fn().mockResolvedValue({
      dsl_version: '1.0',
      metadata: { game_name: 'Test Game', min_players: 2, max_players: 4 },
      entities: [],
      actions: [],
      win_conditions: [],
      conflicts: [],
    }),
    withStructuredOutput: function() { return this; },
  }),
}));

describe('Resume Endpoint Integration', () => {
  let fastify: any;

  beforeEach(async () => {
    _resetDbForTests();
    fastify = await buildServer();
  });

  afterEach(async () => {
    await fastify?.close();
  });

  it('should start a build and allow resume', { timeout: 30000 }, async () => {
    // Step 1: POST /builds to start a build
    const buildRes = await fastify.inject({
      method: 'POST',
      url: '/builds',
      payload: {
        prompt: 'Create a test game',
        mode: 'fully_custom',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
      },
      headers: {
        'x-llm-api-key': 'test-key',
      },
    });

    expect(buildRes.statusCode).toBe(200);
    const { bundle_id } = JSON.parse(buildRes.body);
    expect(bundle_id).toBeDefined();

    // Small delay to allow build to potentially progress
    await new Promise((resolve) => setTimeout(resolve, 100));

    // (Note: we intentionally do NOT GET /builds/:id/stream here — SSE
    // endpoints never close, so fastify.inject would hang the test runner.)

    // Step 2: POST /builds/:id/resume with a decision
    const resumeRes = await fastify.inject({
      method: 'POST',
      url: `/builds/${bundle_id}/resume`,
      payload: {
        decision: {
          'conflict-1': 'accept',
        },
      },
    });

    expect(resumeRes.statusCode).toBe(200);
    const resumeBody = JSON.parse(resumeRes.body);
    expect(resumeBody.ok).toBe(true);
  });

  it('should return 404 if resuming non-existent build', async () => {
    const resumeRes = await fastify.inject({
      method: 'POST',
      url: '/builds/nonexistent-id/resume',
      payload: {
        decision: {
          'conflict-1': 'accept',
        },
      },
    });

    expect(resumeRes.statusCode).toBe(404);
    const body = JSON.parse(resumeRes.body);
    expect(body.error).toContain('not found');
  });

  it('should validate resume request body', async () => {
    // Start a build first
    const buildRes = await fastify.inject({
      method: 'POST',
      url: '/builds',
      payload: {
        prompt: 'Test',
        mode: 'fully_custom',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
      },
      headers: {
        'x-llm-api-key': 'test-key',
      },
    });

    const { bundle_id } = JSON.parse(buildRes.body);

    // Resume with invalid body
    const resumeRes = await fastify.inject({
      method: 'POST',
      url: `/builds/${bundle_id}/resume`,
      payload: {
        invalid_field: 'value',
      },
    });

    expect(resumeRes.statusCode).toBe(400);
  });
});
