/**
 * Web fetcher with caching and HTML/PDF extraction.
 * Uses @mozilla/readability + jsdom for HTML; pdf-parse for PDFs.
 * Per-host rate limiting via p-limit (concurrency 2).
 */
import { fetch } from 'undici';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import pdfParse from 'pdf-parse';
import pLimit from 'p-limit';
import { cacheGet, cachePut } from '../db.js';
import { logger } from '../logger.js';

export interface ExtractedContent {
  url: string;
  text: string;
  source_type: 'pdf' | 'publisher' | 'bgg' | 'fan';
}

const TIMEOUT_MS = 15000;
const USER_AGENT = 'BoardGameBuilder/0.1 (+https://boardgamebuilder.dev/bot)';

// Per-host rate limiters (concurrency 2)
const limiters = new Map<string, ReturnType<typeof pLimit>>();

function getHostLimiter(hostname: string) {
  if (!limiters.has(hostname)) {
    limiters.set(hostname, pLimit(2));
  }
  return limiters.get(hostname)!;
}

/**
 * Classify source type based on URL/host heuristics.
 */
export function classifySourceType(url: string): ExtractedContent['source_type'] {
  const u = new URL(url);

  // PDF by file extension or content-type
  if (u.pathname.toLowerCase().endsWith('.pdf')) return 'pdf';

  // Known publishers
  const publisherHosts = ['uschess.org', 'fide.com', 'daysofwonder.com', 'ravensburger.com', 'hasbro.com', 'fantasyflightgames.com'];
  if (publisherHosts.some((h) => u.hostname?.includes(h))) return 'publisher';

  // BoardGameGeek
  if (u.hostname?.includes('boardgamegeek.com')) return 'bgg';

  // Default to fan
  return 'fan';
}

/**
 * Fetch and extract content from a URL.
 * Applies per-host rate limiting and caching.
 */
export async function fetchAndExtract(url: string): Promise<ExtractedContent> {
  // Check cache first
  const cached = await cacheGet(url);
  if (cached) {
    logger.debug({ url }, 'Cache hit');
    return {
      url,
      text: cached.content,
      source_type: (cached.source_type as ExtractedContent['source_type']) || classifySourceType(url),
    };
  }

  const hostname = new URL(url).hostname || 'unknown';
  const limiter = getHostLimiter(hostname);

  return limiter(async () => {
    logger.debug({ url }, 'Fetching');
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const source_type = classifySourceType(url);

    let text: string;
    const buffer = await response.arrayBuffer();

    if (contentType.startsWith('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
      // Parse PDF — pdf-parse expects a Node Buffer, not an ArrayBuffer.
      const data = await pdfParse(Buffer.from(buffer));
      text = data.text;
    } else {
      // Parse HTML via Readability
      const html = new TextDecoder().decode(buffer);
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      text = article?.textContent || '';
    }

    // Cache the extracted text
    await cachePut(url, text, source_type);

    return {
      url,
      text,
      source_type,
    };
  });
}
