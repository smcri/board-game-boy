/**
 * Fastify server with API endpoints.
 * POST /builds → kick off build
 * GET /builds/:id/stream → SSE
 * POST /builds/:id/resume → resume HITL
 * GET /bundles/:id → stream bundle.json
 * GET /bundles/:id/game.js → stream game.js
 * GET /bundles/:id/assets/* → stream assets
 * GET /bundles/:id/play → tiny index.html
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { BuildState, SseEvent } from '@bgb/shared';
import { config } from './config.js';
import { logger } from './logger.js';
import { getSseEmitter, emitSseEvent, cleanupEmitter } from './sse.js';
import { makeLlm } from './llm.js';
import { runBuild } from './graph.js';
import { nanoid } from 'nanoid';
import { createReadStream, existsSync, readFileSync } from 'fs';

const BuildRequest = z.object({
  prompt: z.string().min(1),
  mode: z.enum(['known_game', 'known_with_overrides', 'fully_custom']),
  custom_rules: z.string().optional(),
  llm_provider: z.enum(['openai', 'anthropic', 'ollama', 'groq']),
  llm_model: z.string().min(1),
  search_provider: z.enum(['tavily', 'brave', 'serpapi']).optional(),
});

const ResumeRequest = z.object({
  decision: z.record(z.unknown()),
});

/**
 * Build the Fastify server.
 */
export async function buildServer() {
  const fastify = Fastify({ logger: true });

  // CORS
  await fastify.register(cors, {
    origin: config.ALLOWED_ORIGINS,
    credentials: true,
  });

  // In-flight builds map: bundle_id → { state, emitter }
  const builds = new Map<string, { state: BuildState; promise: Promise<BuildState> }>();

  // ── Health Check ─────────────────────────────────────────────────────────

  fastify.get('/healthz', async () => {
    return {
      ok: true,
      time: new Date().toISOString(),
    };
  });

  // ── Build Endpoint ───────────────────────────────────────────────────────

  fastify.post<{ Body: z.infer<typeof BuildRequest> }>('/builds', async (request, reply) => {
    const parsed = BuildRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const {
      prompt,
      mode,
      custom_rules,
      llm_provider,
      llm_model,
      search_provider,
    } = parsed.data;

    const bundle_id = nanoid();
    const llm_api_key = request.headers['x-llm-api-key'] as string | undefined;
    const search_api_key = request.headers['x-search-api-key'] as string | undefined;

    const initialState: BuildState = {
      bundle_id,
      prompt,
      mode,
      custom_rules,
      llm_provider,
      llm_model,
      llm_api_key,
      search_provider,
      search_api_key,
      status: 'classifying',
      conflicts: [],
      errors: [],
    };

    // Kick off build async
    let llm;
    try {
      llm = await makeLlm(llm_provider, llm_model, llm_api_key);
    } catch (err) {
      return reply.status(400).send({ error: String(err) });
    }

    const buildPromise = runBuild(initialState, llm);
    builds.set(bundle_id, { state: initialState, promise: buildPromise });

    // Clean up on completion
    buildPromise
      .then((finalState) => {
        const coreConflicts = (finalState.conflicts || []).filter((c) => c.severity === 'core_mechanic');
        emitSseEvent(bundle_id, {
          type: 'done',
          bundle_id,
          bundle_url: `/bundles/${bundle_id}/play`,
          conflicts_summary: {
            blocking: coreConflicts.length,
            non_blocking: (finalState.conflicts || []).length - coreConflicts.length,
            unsupported: (finalState.conflicts || []).filter((c) => c.severity === 'unsupported_effect').length,
          },
        });
      })
      .catch((err) => {
        emitSseEvent(bundle_id, {
          type: 'error',
          node: 'orchestrator',
          message: String(err),
        });
      })
      .finally(() => {
        setTimeout(() => {
          builds.delete(bundle_id);
          cleanupEmitter(bundle_id);
        }, 60000); // Clean up after 1 minute
      });

    return { bundle_id };
  });

  // ── SSE Stream ───────────────────────────────────────────────────────────

  fastify.get('/builds/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const emitter = getSseEmitter(id);
    const buffer = emitter.getBuffer();

    // Replay buffered events
    for (const event of buffer) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // Stream live events
    const handler = (event: SseEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    emitter.on('event', handler);

    request.raw.on('close', () => {
      emitter.removeListener('event', handler);
    });
  });

  // ── Resume Endpoint ──────────────────────────────────────────────────────

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof ResumeRequest> }>(
    '/builds/:id/resume',
    async (request, reply) => {
      const { id } = request.params;
      const parsed = ResumeRequest.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const build = builds.get(id);
      if (!build) {
        return reply.status(404).send({ error: 'Build not found' });
      }

      // TODO: Update build.state.user_decision and resume graph execution
      // For MVP, this is a placeholder.

      return { ok: true };
    },
  );

  // ── Bundle Download ──────────────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/bundles/:id', async (request, reply) => {
    const { id } = request.params;
    const bundlePath = `${config.BUNDLES_DIR}/${id}/bundle.json`;

    if (!existsSync(bundlePath)) {
      return reply.status(404).send({ error: 'Bundle not found' });
    }

    reply.type('application/json');
    return createReadStream(bundlePath);
  });

  fastify.get<{ Params: { id: string } }>('/bundles/:id/game.js', async (request, reply) => {
    const { id } = request.params;
    const gamePath = `${config.BUNDLES_DIR}/${id}/game.js`;

    if (!existsSync(gamePath)) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    reply.type('application/javascript');
    return createReadStream(gamePath);
  });

  fastify.get<{ Params: { id: string; path: string } }>('/bundles/:id/assets/*', async (request, reply) => {
    const { id } = request.params;
    const path = (request.params as { path: string }).path;
    const assetPath = `${config.BUNDLES_DIR}/${id}/assets/${path}`;

    if (!existsSync(assetPath)) {
      return reply.status(404).send({ error: 'Asset not found' });
    }

    if (path.endsWith('.svg')) {
      reply.type('image/svg+xml');
    }
    return createReadStream(assetPath);
  });

  // ── Play Page ────────────────────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/bundles/:id/play', async (request, reply) => {
    const { id } = request.params;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Board Game</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    #game { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="game"></div>
  <script>
    window.BUNDLE_ID = '${id}';
    window.BUNDLE_URL = '/bundles/${id}/bundle.json';
  </script>
  <script src="/bundles/${id}/game.js"><\/script>
</body>
</html>
    `;

    reply.type('text/html');
    return html;
  });

  return fastify;
}
