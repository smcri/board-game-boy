/**
 * Simple checkpoint saver for LangGraph state persistence.
 * Stores serialized state in the libsql database.
 * Strips all *api_key and *token fields before persisting to prevent credential leaks.
 * 
 * CLOSED: gap 1 - SqliteSaver checkpointer integrated
 * Note: LangGraph 0.0.21 has limited checkpoint support; this is a minimal implementation
 * that stores state snapshots keyed by thread_id and checkpoint_id.
 */
import { getDb } from './db.js';
import { createHash } from 'crypto';
import { logger } from './logger.js';

const SCRUB_PATTERN = /^(.+?)(_api_key|_token|api_key|token)$/i;

/**
 * Scrub sensitive keys from an object tree before persisting.
 */
function scrubSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(scrubSensitive);
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SCRUB_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = scrubSensitive(value);
    }
  }
  return result;
}

/**
 * SqliteSaver: persists LangGraph checkpoints to libsql database.
 * Provides a simple key-value store for thread state snapshots.
 */
export class SqliteSaver {
  async initSchema(): Promise<void> {
    const db = getDb();
    await db.execute(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        parent_id TEXT,
        ts INTEGER NOT NULL,
        state TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_id)
      )
    `);
    logger.debug('Checkpoints table initialized');
  }

  /**
   * Save a checkpoint for a thread.
   * @param state - The state object to persist
   * @param metadata - Optional metadata (parent_id, etc.)
   * @param threadId - Thread identifier for grouping checkpoints
   * @returns checkpoint ID
   */
  async putCheckpoint(
    state: unknown,
    metadata: Record<string, unknown>,
    threadId: string,
  ): Promise<string> {
    const db = getDb();
    const checkpointId = createHash('sha256').update(JSON.stringify(state) + Date.now()).digest('hex').slice(0, 12);
    const parentId = metadata?.parent_id as string | undefined;
    const ts = Date.now();

    // Scrub sensitive fields from state before persisting
    const cleanState = scrubSensitive(state);

    const sql = `
      INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_id, parent_id, ts, state)
      VALUES (?, ?, ?, ?, ?)
    `;

    const args = [
      threadId,
      checkpointId,
      parentId || null,
      ts,
      JSON.stringify(cleanState),
    ] as const;

    await db.execute({ sql, args: args as any });

    logger.debug({ threadId, checkpointId }, 'Checkpoint saved');
    return checkpointId;
  }

  /**
   * Retrieve a checkpoint for a thread.
   * @param threadId - Thread identifier
   * @param checkpointId - Optional specific checkpoint ID; if not provided, returns latest
   * @returns checkpoint state or undefined if not found
   */
  async getCheckpoint(threadId: string, checkpointId?: string): Promise<unknown | undefined> {
    const db = getDb();

    let sql: string;
    let args: any[];

    if (checkpointId) {
      sql = `
        SELECT state FROM checkpoints
        WHERE thread_id = ? AND checkpoint_id = ?
        LIMIT 1
      `;
      args = [threadId, checkpointId];
    } else {
      sql = `
        SELECT state FROM checkpoints
        WHERE thread_id = ?
        ORDER BY ts DESC
        LIMIT 1
      `;
      args = [threadId];
    }

    const result = await db.execute({ sql, args: args as any });
    if (!result.rows[0]) {
      return undefined;
    }

    const stateStr = (result.rows[0] as Record<string, unknown>).state as string;
    return JSON.parse(stateStr);
  }

  /**
   * List all checkpoints for a thread.
   * @param threadId - Thread identifier
   * @returns array of checkpoint states
   */
  async listCheckpoints(threadId: string): Promise<unknown[]> {
    const db = getDb();
    const result = await db.execute({
      sql: `
        SELECT state FROM checkpoints
        WHERE thread_id = ?
        ORDER BY ts DESC
      `,
      args: [threadId] as any,
    });

    return result.rows.map((row) => {
      const stateStr = (row as Record<string, unknown>).state as string;
      return JSON.parse(stateStr);
    });
  }
}
