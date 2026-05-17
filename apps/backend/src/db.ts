/**
 * SQLite database for fetch cache and bundle metadata.
 * The LangGraph SqliteSaver will create its own tables in the same file.
 * See doc 06 for cache schema details.
 */
import Database from 'better-sqlite3';
import { SQLITE_PATH, config } from './config.js';
import { logger } from './logger.js';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';

/** Ensure data dir exists */
mkdirSync(config.DATA_DIR, { recursive: true });

export const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');

/**
 * Initialize database schema on startup.
 */
export function initDb() {
  // Fetch cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS fetches (
      url_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      content_hash TEXT,
      content TEXT NOT NULL,
      source_type TEXT,
      fetched_at INTEGER NOT NULL
    );
  `);

  // Bundle metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundles (
      bundle_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      metadata TEXT
    );
  `);

  logger.info('Database initialized');
}

/**
 * Retrieve cached content by URL.
 */
export function cacheGet(url: string): { content: string; source_type?: string } | null {
  const hash = createHash('sha256').update(url).digest('hex');
  const row = db.prepare('SELECT content, source_type FROM fetches WHERE url_hash = ?').get(hash) as
    | { content: string; source_type?: string }
    | undefined;
  return row ?? null;
}

/**
 * Store fetched content in cache.
 */
export function cachePut(url: string, content: string, source_type?: string, content_hash?: string) {
  const url_hash = createHash('sha256').update(url).digest('hex');
  const hash = content_hash || createHash('sha256').update(content).digest('hex');
  db.prepare(
    `
    INSERT OR REPLACE INTO fetches
    (url_hash, url, content_hash, content, source_type, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(url_hash, url, hash, content, source_type, Date.now());
}

/**
 * Store bundle metadata.
 */
export function bundleMetadataPut(bundle_id: string, metadata: unknown) {
  db.prepare(`
    INSERT OR REPLACE INTO bundles (bundle_id, created_at, metadata)
    VALUES (?, ?, ?)
  `).run(bundle_id, Date.now(), JSON.stringify(metadata));
}
