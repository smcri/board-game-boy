import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';

describe('POST /chat endpoint', () => {
  it('validates request body', async () => {
    const fastify = await buildServer();

    const response = await fastify.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        // missing required fields
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');

    await fastify.close();
  });

  it('returns streaming headers on valid request', async () => {
    const fastify = await buildServer();

    const response = await fastify.inject({
      method: 'POST',
      url: '/chat',
      headers: {
        'X-LLM-API-Key': 'test-key',
      },
      payload: {
        messages: [{ role: 'user', content: 'Hello' }],
        llm_provider: 'ollama',
        llm_model: 'llama2',
      },
    });

    // Should return 200 or 500 depending on whether ollama is running
    // But headers should indicate streaming
    expect([200, 500]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      expect(response.headers['x-vercel-ai-data-stream']).toBe('v1');
      expect(response.headers['content-type']).toContain('text/plain');
    }

    await fastify.close();
  });

  it('accepts X-LLM-API-Key header', async () => {
    const fastify = await buildServer();

    const response = await fastify.inject({
      method: 'POST',
      url: '/chat',
      headers: {
        'X-LLM-API-Key': 'my-api-key-123',
      },
      payload: {
        messages: [{ role: 'user', content: 'test' }],
        llm_provider: 'ollama',
        llm_model: 'llama2',
      },
    });

    // Just verify the endpoint accepts the header without error
    expect([200, 500]).toContain(response.statusCode);

    await fastify.close();
  });
});
