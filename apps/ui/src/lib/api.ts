import {
  API_HEADER_LLM_KEY,
  API_HEADER_SEARCH_KEY,
  SseEvent,
} from '@bgb/shared';
import { getLlmKey, getSearchKey } from './storage';

/**
 * Get the backend base URL from environment.
 * Falls back to current origin if not set (for dev/testing).
 */
function getBackendUrl(): string {
  return import.meta.env.VITE_BACKEND_URL || window.location.origin;
}

/**
 * Request body for creating a new build.
 */
export interface CreateBuildRequest {
  prompt: string;
  mode: 'known_game' | 'known_with_overrides' | 'fully_custom';
  custom_rules?: string;
  llm_provider: string;
  llm_model: string;
  search_provider?: string;
}

/**
 * Response from creating a build.
 */
export interface CreateBuildResponse {
  bundle_id: string;
}

/**
 * Create a new build with the given parameters.
 * Attaches X-LLM-API-Key and X-SEARCH-API-Key headers from localStorage.
 * Never includes keys in the body or as query strings.
 *
 * @param req - The build request.
 * @returns The response containing the bundle ID.
 * @throws Error if the request fails.
 */
export async function createBuild(
  req: CreateBuildRequest,
): Promise<CreateBuildResponse> {
  const backendUrl = getBackendUrl();
  const llmKey = getLlmKey(req.llm_provider as any);
  const searchKey = req.search_provider ? getSearchKey(req.search_provider as any) : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Attach API keys via headers, never in body or query.
  if (llmKey) {
    headers[API_HEADER_LLM_KEY] = llmKey;
  }
  if (searchKey) {
    headers[API_HEADER_SEARCH_KEY] = searchKey;
  }

  const response = await fetch(`${backendUrl}/builds`, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    throw new Error(`Failed to create build: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Open an SSE stream for a build.
 * Parses each event as a line-delimited JSON SseEvent and calls the callback.
 *
 * @param bundleId - The bundle ID to stream.
 * @param onEvent - Callback invoked for each event.
 * @returns A function to close the event source.
 * @throws Error if parsing fails or the request cannot be set up.
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
      // Validate via Zod schema from shared.
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
 * Request body for resuming a build after HITL interrupt.
 */
export interface ResumeBuildRequest {
  decision: Record<string, { decision: 'accept' | 'override'; value?: unknown; note?: string }>;
}

/**
 * Resume a paused build with user decisions.
 * Attaches X-LLM-API-Key and X-SEARCH-API-Key headers from localStorage.
 *
 * @param bundleId - The bundle ID to resume.
 * @param decision - The conflict resolution map.
 * @throws Error if the request fails.
 */
export async function resumeBuild(
  bundleId: string,
  decision: ResumeBuildRequest['decision'],
): Promise<void> {
  const backendUrl = getBackendUrl();
  const llmKey = getLlmKey('openai' as any); // TODO: infer from context
  const searchKey = getSearchKey('tavily' as any); // TODO: infer from context

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (llmKey) {
    headers[API_HEADER_LLM_KEY] = llmKey;
  }
  if (searchKey) {
    headers[API_HEADER_SEARCH_KEY] = searchKey;
  }

  const response = await fetch(`${backendUrl}/builds/${bundleId}/resume`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision }),
  });

  if (!response.ok) {
    throw new Error(`Failed to resume build: ${response.statusText}`);
  }
}
