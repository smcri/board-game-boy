import {
  API_HEADER_LLM_KEY,
  API_HEADER_SEARCH_KEY,
  SseEvent,
  type LlmProvider,
  type SearchProvider,
  type BuildMode,
} from '@bgb/shared';
import { getLlmKey, getSearchKey } from './storage';

/**
 * Backend base URL — sourced from VITE_BACKEND_URL at build/dev time. Falls
 * back to current origin only if the env var is missing (useful for tests).
 */
export function getBackendUrl(): string {
  return import.meta.env.VITE_BACKEND_URL || window.location.origin;
}

/**
 * Request body for POST /builds. Types come from `@bgb/shared` so the UI and
 * backend cannot drift apart.
 */
export interface CreateBuildRequest {
  prompt: string;
  mode: BuildMode;
  custom_rules?: string;
  llm_provider: LlmProvider;
  llm_model: string;
  search_provider?: SearchProvider;
}

export interface CreateBuildResponse {
  bundle_id: string;
}

/**
 * Inputs needed to build the auth headers for any build/resume request.
 */
interface KeyContext {
  llm_provider: LlmProvider;
  search_provider?: SearchProvider;
}

/**
 * Build the per-request auth headers from localStorage.
 * Never accepts keys via body or query string. Throws a clear error if any
 * stored key contains HTTP-illegal characters that survived input-time
 * normalisation.
 */
function buildKeyHeaders(ctx: KeyContext): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const llmKey = getLlmKey(ctx.llm_provider);
  if (llmKey) {
    headers[API_HEADER_LLM_KEY] = sanitizeHeader(API_HEADER_LLM_KEY, llmKey);
  }
  if (ctx.search_provider) {
    const searchKey = getSearchKey(ctx.search_provider);
    if (searchKey) {
      headers[API_HEADER_SEARCH_KEY] = sanitizeHeader(API_HEADER_SEARCH_KEY, searchKey);
    }
  }
  return headers;
}

/**
 * Validate and clean an HTTP header value.
 * `fetch` rejects header values containing CR/LF/NUL or characters outside
 * the visible ASCII range. We trim aggressively and throw a clear error if
 * any illegal character survives.
 */
function sanitizeHeader(name: string, raw: string): string {
  const trimmed = raw.replace(/^\s+|\s+$/g, '');
  if (!trimmed) {
    throw new Error(`Header ${name} is empty after trimming.`);
  }
  // RFC 7230 allows VCHAR (0x21-0x7E), SP, HTAB. Reject anything else.
  if (!/^[\x21-\x7E \t]+$/.test(trimmed)) {
    throw new Error(
      `Header ${name} contains illegal characters (control chars or non-ASCII). ` +
        `Re-paste the key — it may have had a trailing newline or stray whitespace.`,
    );
  }
  return trimmed;
}

/**
 * Read the error body of a non-OK response, truncated for log safety.
 */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text ? ' — ' + text.slice(0, 200) : '';
  } catch {
    return '';
  }
}

/**
 * POST /builds — kick off a new build. Returns the bundle_id immediately;
 * caller should then open the SSE stream to observe progress.
 */
export async function createBuild(req: CreateBuildRequest): Promise<CreateBuildResponse> {
  const backendUrl = getBackendUrl();
  const headers = buildKeyHeaders({
    llm_provider: req.llm_provider,
    search_provider: req.search_provider,
  });

  const response = await fetch(`${backendUrl}/builds`, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create build (${response.status}): ${response.statusText}${await readErrorDetail(response)}`,
    );
  }
  return response.json();
}

/**
 * GET /builds/:id/stream — open an SSE stream and dispatch parsed events.
 * Returns a close function. EventSource cannot send custom headers, so the
 * stream endpoint does not require API keys (server reads them from the
 * checkpointed state set during createBuild).
 */
export function openBuildStream(
  bundleId: string,
  onEvent: (event: SseEvent) => void,
): () => void {
  const backendUrl = getBackendUrl();
  const eventSource = new EventSource(`${backendUrl}/builds/${bundleId}/stream`);

  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      const validated = SseEvent.parse(parsed);
      onEvent(validated);
    } catch (err) {
      console.error('Failed to parse SSE event:', err, 'data:', event.data);
    }
  };
  eventSource.onerror = () => {
    console.error('SSE connection error');
    eventSource.close();
  };
  return () => eventSource.close();
}

/**
 * Body for POST /builds/:id/resume.
 */
export interface ResumeBuildRequest {
  decision: Record<string, { decision: 'accept' | 'override'; value?: unknown; note?: string }>;
}

/**
 * POST /builds/:id/resume — resume a paused build with user decisions.
 * Caller must pass the same llm_provider / search_provider used to start the
 * build so we attach the correct stored keys.
 */
export async function resumeBuild(
  bundleId: string,
  decision: ResumeBuildRequest['decision'],
  ctx: KeyContext,
): Promise<void> {
  const backendUrl = getBackendUrl();
  const headers = buildKeyHeaders(ctx);

  const response = await fetch(`${backendUrl}/builds/${bundleId}/resume`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to resume build (${response.status}): ${response.statusText}${await readErrorDetail(response)}`,
    );
  }
}
