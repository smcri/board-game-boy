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
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { BuildState, SseEvent, LlmProvider, SearchProvider, BuildMode } from '@bgb/shared';
import { config } from './config.js';
import { logger } from './logger.js';
import { getSseEmitter, emitSseEvent, cleanupEmitter } from './sse.js';
import { makeLlm } from './llm.js';
import { chatStream, type ChatMessage } from './chat.js';
import { runBuild } from './graph.js';
import { nanoid } from 'nanoid';
import { createReadStream, existsSync, readFileSync } from 'fs';

const BuildRequest = z.object({
  prompt: z.string().min(1),
  mode: BuildMode,
  custom_rules: z.string().optional(),
  llm_provider: LlmProvider,
  llm_model: z.string().min(1),
  search_provider: SearchProvider.optional(),
});

const ResumeRequest = z.object({
  decision: z.record(z.unknown()),
});

const ChatRequest = z.object({
  messages: z.array(
    z.object({
      // eslint-disable-next-line no-restricted-syntax -- chat role is a Vercel AI SDK contract enum, not a cross-cutting one
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    }),
  ),
  llm_provider: LlmProvider,
  llm_model: z.string().min(1),
});

/**
 * Build the Fastify server.
 */
export async function buildServer() {
  const fastify = Fastify({ logger: true });

  // CORS
  // When ALLOWED_ORIGINS=['*'] (set via env on HF Spaces or public deployments),
  // we allow all origins. Note: credentials:true requires a non-wildcard origin
  // when the request sends cookies/auth headers. For API-key-in-header pattern
  // we don't need credentials:true when origin is '*'.
  const isWildcard = config.ALLOWED_ORIGINS.length === 1 && config.ALLOWED_ORIGINS[0] === '*';
  await fastify.register(cors, {
    origin: isWildcard ? '*' : config.ALLOWED_ORIGINS,
    credentials: !isWildcard,
  });

  // In-flight builds map: bundle_id → { state, emitter }
  const builds = new Map<string, { state: BuildState; promise: Promise<BuildState> }>();

  /**
   * Read an API-key header in a defence-in-depth way: the UI is supposed to
   * have already normalised the value, but if a control character (CR, LF,
   * NUL) ever sneaks through we refuse the request loudly rather than letting
   * a downstream HTTP client (LangChain → provider) throw an opaque error.
   */
  function readKeyHeader(headers: Record<string, unknown>, name: string): string | undefined {
    const raw = headers[name];
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    // RFC 7230 VCHAR + SP + HTAB only.
    if (!/^[\x21-\x7E \t]+$/.test(trimmed)) {
      throw new Error(`Header ${name} contains illegal characters.`);
    }
    return trimmed;
  }

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
    const llm_api_key = readKeyHeader(request.headers as Record<string, unknown>, 'x-llm-api-key');
    const search_api_key = readKeyHeader(request.headers as Record<string, unknown>, 'x-search-api-key');

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

    // Set SSE headers — let @fastify/cors handle Access-Control-Allow-Origin
    reply
      .code(200)
      .header('Content-Type', 'text/event-stream')
      .header('Cache-Control', 'no-cache')
      .header('Connection', 'keep-alive');
    // Flush headers immediately so the browser opens the event stream
    // without waiting for the first data event (avoids proxy buffering).
    reply.raw.flushHeaders();

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

      // CLOSED: gap 3 - resume builds after HITL interrupt
      // Merge user decision into state and resume graph from checkpoint
      const decision = parsed.data.decision as Record<string, 'accept' | 'override' | { value?: unknown; note?: string }>;
      const resumedState: BuildState = {
        ...build.state,
        user_decision: decision,
      };

      // Apply decisions to conflicts
      if (resumedState.conflicts) {
        for (const [conflictId, decisionValue] of Object.entries(decision)) {
          const conflict = resumedState.conflicts.find((c) => c.id === conflictId);
          if (conflict) {
            if (typeof decisionValue === 'string') {
              conflict.resolution = { decision: decisionValue as 'accept' | 'override' };
            } else if (typeof decisionValue === 'object' && decisionValue !== null && 'value' in decisionValue) {
              conflict.resolution = {
                decision: 'override',
                value: (decisionValue as any).value,
                note: (decisionValue as any).note,
              };
            }
          }
        }
      }

      // Resume must re-supply the API key via headers — keys are never
      // persisted in the in-memory state map (and would be scrubbed from any
      // persisted copy). Header takes priority; fall back to whatever is in
      // the build's state for the rare case the client kept the original
      // value alive.
      const resumeLlmKey =
        readKeyHeader(request.headers as Record<string, unknown>, 'x-llm-api-key') ??
        build.state.llm_api_key;
      const resumeSearchKey =
        readKeyHeader(request.headers as Record<string, unknown>, 'x-search-api-key') ??
        build.state.search_api_key;

      // Carry both keys forward in the state so any downstream node that
      // re-reads them (asset_agent, frontend_agent) doesn't see undefined.
      resumedState.llm_api_key = resumeLlmKey;
      resumedState.search_api_key = resumeSearchKey;

      // Update the stored state
      build.state = resumedState;

      if (!resumeLlmKey) {
        return reply.status(400).send({
          error:
            'Resume requires the LLM API key in the x-llm-api-key header (keys are never persisted server-side).',
        });
      }

      // Re-invoke graph to continue from checkpoint
      const llm = await makeLlm(build.state.llm_provider, build.state.llm_model, resumeLlmKey);
      const resumedPromise = runBuild(resumedState, llm);
      builds.set(id, { state: resumedState, promise: resumedPromise });

      // Clean up on completion
      resumedPromise
        .then((finalState) => {
          const coreConflicts = (finalState.conflicts || []).filter((c) => c.severity === 'core_mechanic');
          emitSseEvent(id, {
            type: 'done',
            bundle_id: id,
            bundle_url: `/bundles/${id}/play`,
            conflicts_summary: {
              blocking: coreConflicts.length,
              non_blocking: (finalState.conflicts || []).length - coreConflicts.length,
              unsupported: (finalState.conflicts || []).filter((c) => c.severity === 'unsupported_effect').length,
            },
          });
        })
        .catch((err) => {
          emitSseEvent(id, {
            type: 'error',
            node: 'orchestrator',
            message: String(err),
          });
        })
        .finally(() => {
          setTimeout(() => {
            builds.delete(id);
            cleanupEmitter(id);
          }, 60000);
        });

      return { ok: true };
    },
  );

  // ── Chat Endpoint ───────────────────────────────────────────────────────

  fastify.post<{ Body: z.infer<typeof ChatRequest> }>('/chat', async (request, reply) => {
    const parsed = ChatRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const { messages, llm_provider, llm_model } = parsed.data;
    const llm_api_key = readKeyHeader(request.headers as Record<string, unknown>, 'x-llm-api-key');

    // Set streaming headers — let @fastify/cors handle Access-Control-Allow-Origin.
    // We set headers directly on the raw stream so flushHeaders() picks them up
    // immediately (Fastify's reply.header() is only written when the handler returns).
    reply.raw.statusCode = 200;
    reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
    reply.raw.setHeader('X-Vercel-AI-Data-Stream', 'v1');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    try {
      // Stream chat response
      const stream = chatStream({
        provider: llm_provider,
        model: llm_model,
        apiKey: llm_api_key,
        messages: messages as ChatMessage[],
      });

      for await (const token of stream) {
        // Vercel AI SDK data-stream format: each chunk is `0:"<json-escaped text>"\n`
        const escaped = JSON.stringify(token);
        reply.raw.write(`0:${escaped}\n`);
      }

      // End the stream
      reply.raw.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'Chat error');
      // If headers already sent, just close the connection
      if (!reply.raw.headersSent) {
        return reply.status(500).send({ error: message });
      }
      reply.raw.end();
    }
  });

  // ── Bundle Download ──────────────────────────────────────────────────────

  // Both /bundles/:id and /bundles/:id/bundle.json serve bundle.json
  const serveBundleJson = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const bundlePath = `${config.BUNDLES_DIR}/${id}/bundle.json`;

    if (!existsSync(bundlePath)) {
      return reply.status(404).send({ error: 'Bundle not found' });
    }

    reply.type('application/json');
    return createReadStream(bundlePath);
  };
  fastify.get<{ Params: { id: string } }>('/bundles/:id', serveBundleJson);
  fastify.get<{ Params: { id: string } }>('/bundles/:id/bundle.json', serveBundleJson);
  fastify.get<{ Params: { id: string } }>('/bundles/:id/download', async (request, reply) => {
    const { id } = request.params;
    const bundlePath = `${config.BUNDLES_DIR}/${id}/bundle.json`;
    if (!existsSync(bundlePath)) {
      return reply.status(404).send({ error: 'Bundle not found' });
    }
    reply
      .type('application/json')
      .header('Content-Disposition', `attachment; filename="${id}.bundle.json"`);
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
    const rawPath = (request.params as { path: string }).path;

    // Guard against path traversal: normalise and ensure the resolved path
    // stays within the expected bundle assets directory.
    const nodePath = await import('node:path');
    const bundleAssetsDir = nodePath.resolve(config.BUNDLES_DIR, id, 'assets');
    const resolvedAssetPath = nodePath.resolve(bundleAssetsDir, rawPath);
    if (!resolvedAssetPath.startsWith(bundleAssetsDir + nodePath.sep) &&
        resolvedAssetPath !== bundleAssetsDir) {
      return reply.status(400).send({ error: 'Invalid asset path' });
    }

    if (!existsSync(resolvedAssetPath)) {
      return reply.status(404).send({ error: 'Asset not found' });
    }

    if (rawPath.endsWith('.svg')) {
      reply.type('image/svg+xml');
    }
    return createReadStream(resolvedAssetPath);
  });

  // ── Play Page ────────────────────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/bundles/:id/play', async (request, reply) => {
    const { id } = request.params;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Board Game</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; }
    #game { width: 100vw; min-height: 100vh; }
    #loader {
      position: fixed; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px;
      background: #0f172a; z-index: 100;
    }
    .spinner {
      width: 40px; height: 40px; border: 4px solid #334155;
      border-top-color: #6366f1; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #error-box {
      display: none; position: fixed; inset: 0; align-items: center;
      justify-content: center; background: #0f172a; z-index: 200;
    }
    #error-box.visible { display: flex; }
    .error-card {
      background: #1e293b; border: 1px solid #ef4444; border-radius: 12px;
      padding: 32px; max-width: 480px; text-align: center;
    }
    .error-card h2 { margin: 0 0 12px; color: #ef4444; font-size: 1.25rem; }
    .error-card p { margin: 0; color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
    .error-card code { color: #fbbf24; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div id="loader">
    <div class="spinner"></div>
    <span style="color:#94a3b8;font-size:0.9rem">Loading game…</span>
  </div>

  <div id="error-box">
    <div class="error-card">
      <h2>⚠️ Game failed to load</h2>
      <p id="error-msg">An error occurred while loading the game engine.</p>
      <p style="margin-top:12px">
        Bundle ID: <code>${id}</code><br>
        Try rebuilding the game or check the server logs.
      </p>
    </div>
  </div>

  <div id="game"></div>

  <script>
    window.BUNDLE_ID = '${id}';
    window.BUNDLE_URL = '/bundles/${id}/bundle.json';

    // Hide loader once game initialises
    window.__gameMounted = function() {
      document.getElementById('loader').style.display = 'none';
    };

    // Show error if game.js throws or if it never calls __gameMounted
    window.onerror = function(msg, src, line, col, err) {
      document.getElementById('loader').style.display = 'none';
      document.getElementById('error-msg').textContent =
        (err && err.message) ? err.message : String(msg);
      document.getElementById('error-box').classList.add('visible');
      return true;
    };

    // Timeout fallback: if __gameMounted not called within 10s, show error
    var mountTimeout = setTimeout(function() {
      if (document.getElementById('loader').style.display !== 'none') {
        document.getElementById('loader').style.display = 'none';
        document.getElementById('error-msg').textContent =
          'game.js loaded but did not initialise within 10 seconds. ' +
          'The game engine may be missing or malformed.';
        document.getElementById('error-box').classList.add('visible');
      }
    }, 10000);

    window.__gameMounted = function() {
      clearTimeout(mountTimeout);
      document.getElementById('loader').style.display = 'none';
    };
  </script>
  <script src="/bundles/${id}/game.js" onerror="
    clearTimeout(mountTimeout);
    document.getElementById('loader').style.display = 'none';
    document.getElementById('error-msg').textContent = 'game.js could not be loaded. The file may be missing or the build failed.';
    document.getElementById('error-box').classList.add('visible');
  "></script>
</body>
</html>
    `;

    reply.type('text/html');
    return html;
  });

  return fastify;
}
