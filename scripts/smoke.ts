#!/usr/bin/env tsx
/**
 * smoke.ts — end-to-end smoke test against a running backend.
 *
 * Usage:
 *   pnpm smoke --backend http://localhost:8787 \
 *              --llm ollama --model llama3.1:8b \
 *              --search tavily --search-key tvly-XXXX \
 *              --prompt "Tic-Tac-Toe" --mode known_game
 *
 * Notes:
 *   - The backend must be running. This script does NOT start it.
 *   - For Ollama, no LLM key is required. For OpenAI/Anthropic/Groq, pass --llm-key.
 *   - Exits 0 on a complete build (status=done), 1 otherwise.
 *   - Streams SSE events to stdout for live visibility.
 */

import { request } from 'undici';

interface Args {
  backend: string;
  llm: string;
  model: string;
  llmKey?: string;
  search?: string;
  searchKey?: string;
  prompt: string;
  mode: string;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  const req = (k: string, fallback?: string) => out[k] ?? fallback ?? '';
  if (!out.prompt) {
    console.error('--prompt is required');
    process.exit(2);
  }
  return {
    backend: req('backend', 'http://localhost:8787'),
    llm: req('llm', 'ollama'),
    model: req('model', 'llama3.1:8b'),
    llmKey: out['llm-key'],
    search: out['search'],
    searchKey: out['search-key'],
    prompt: req('prompt'),
    mode: req('mode', 'known_game'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (args.llmKey) headers['x-llm-api-key'] = args.llmKey;
  if (args.searchKey) headers['x-search-api-key'] = args.searchKey;

  // 1. health
  const health = await request(`${args.backend}/healthz`).catch((e: unknown) => {
    console.error('Backend not reachable:', e);
    process.exit(1);
  });
  if (health.statusCode !== 200) {
    console.error('Healthz failed:', health.statusCode);
    process.exit(1);
  }
  console.log('▶ Backend healthy');

  // 2. create build
  const createBody = {
    prompt: args.prompt,
    mode: args.mode,
    llm_provider: args.llm,
    llm_model: args.model,
    ...(args.search ? { search_provider: args.search } : {}),
  };
  const createRes = await request(`${args.backend}/builds`, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody),
  });
  if (createRes.statusCode !== 200 && createRes.statusCode !== 201) {
    console.error('POST /builds failed:', createRes.statusCode, await createRes.body.text());
    process.exit(1);
  }
  const { bundle_id } = (await createRes.body.json()) as { bundle_id: string };
  console.log(`▶ bundle_id = ${bundle_id}`);

  // 3. open SSE stream
  const stream = await request(`${args.backend}/builds/${bundle_id}/stream`, {
    headers: { accept: 'text/event-stream' },
  });
  if (stream.statusCode !== 200) {
    console.error('SSE stream failed:', stream.statusCode);
    process.exit(1);
  }

  let success = false;
  let errored = false;
  let buf = '';
  for await (const chunk of stream.body) {
    buf += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload) continue;
      try {
        const evt = JSON.parse(payload);
        console.log('◀', evt.type, JSON.stringify(evt));
        if (evt.type === 'done') {
          success = true;
        } else if (evt.type === 'error') {
          errored = true;
        } else if (evt.type === 'interrupt') {
          console.warn('Build interrupted by core-mechanic conflicts; smoke test will not auto-resume.');
          errored = true;
        }
      } catch {
        console.warn('non-JSON SSE frame:', payload);
      }
      if (success || errored) break;
    }
    if (success || errored) break;
  }
  process.exit(success ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
