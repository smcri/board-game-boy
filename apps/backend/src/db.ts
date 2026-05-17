/**
 * SQLite database for fetch cache and bundle metadata, using @libsql/client.
 *
 * Why libsql instead of better-sqlite3:
 *   better-sqlite3 has no prebuild for Node 24 and requires a working C++
 *   toolchain to compile; @libsql/client is pure JS (no native build) and works
 *   on any Node version. The API is async; we adopt that throughout the backend.
 *
 * Schema is identical to the original design (doc 06):
 *   - fetches: URL-keyed fetch cache for the rules agent.
 *   - bundles: lightweight metadata about completed builds.
 * The LangGraph checkpointer keeps its own state in a parallel store; see
 * apps/backend/src/graph.ts.
 */
import { createClient, type Client, type InValue } from '@libsql/client';
import { config, SQLITE_PATH } from './config.js';
import { logger } from './logger.js';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';

let client: Client | undefined;

/** Returns the cached libsql client, creating it on first call. */
export function getDb(): Client {
  if (!client) {
    mkdirSync(config.DATA_DIR, { recursive: true });
    client = createClient({ url: `file:${SQLITE_PATH}` });
  }
  return client;
}

/** Initialise the schema on startup. Safe to call multiple times. */
export async function initDb(): Promise<void> {
  const db = getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS fetches (
      url_hash      TEXT PRIMARY KEY,
      url           TEXT NOT NULL,
      content_hash  TEXT,
      content       TEXT NOT NULL,
      source_type   TEXT,
      fetched_at    INTEGER NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bundles (
      bundle_id  TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      metadata   TEXT
    );
  `);
  logger.info('Database initialised');
}

/** Retrieve cached fetched content for a URL, or null on miss. */
export async function cacheGet(
  url: string,
): Promise<{ content: string; source_type?: string } | null> {
  const db = getDb();
  const url_hash = createHash('sha256').update(url).digest('hex');
  const res = await db.execute({
    sql: 'SELECT content, source_type FROM fetches WHERE url_hash = ?',
    args: [url_hash],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    content: row.content as string,
    source_type: (row.source_type ?? undefined) as string | undefined,
  };
}

/** Store fetched content in cache, overwriting any prior entry. */
export async function cachePut(
  url: string,
  content: string,
  source_type?: string,
  content_hash?: string,
): Promise<void> {
  const db = getDb();
  const url_hash = createHash('sha256').update(url).digest('hex');
  const hash = content_hash ?? createHash('sha256').update(content).digest('hex');
  const args: InValue[] = [url_hash, url, hash, content, source_type ?? null, Date.now()];
  await db.execute({
    sql: `INSERT OR REPLACE INTO fetches
          (url_hash, url, content_hash, content, source_type, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args,
  });
}

/** Record metadata for a completed bundle build. */
export async function bundleMetadataPut(bundle_id: string, metadata: unknown): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO bundles (bundle_id, created_at, metadata) VALUES (?, ?, ?)`,
    args: [bundle_id, Date.now(), JSON.stringify(metadata)],
  });
}

/**
 * Test-only helper: replace the cached client with a fresh in-memory libsql
 * instance. Call this from test setUp; never from production code.
 */
export function _resetDbForTests(url = ':memory:'): void {
  if (client) client.close();
  client = createClient({ url });
}
