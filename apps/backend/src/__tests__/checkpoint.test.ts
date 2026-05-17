/**
 * Test for SqliteSaver checkpoint persistence.
 * CLOSED: gap 1 - checkpoint test
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteSaver } from '../checkpoint.js';
import { _resetDbForTests } from '../db.js';

describe('SqliteSaver Checkpointer', () => {
  beforeEach(async () => {
    // Use in-memory SQLite for tests
    _resetDbForTests();
    const saver = new SqliteSaver();
    await saver.initSchema();
  });

  it('should save and retrieve checkpoints', async () => {
    const saver = new SqliteSaver();

    const checkpoint = {
      bundle_id: 'test-bundle',
      status: 'classifying',
      rules_dsl: null,
    };

    const metadata = { parent_id: null };
    const threadId = 't1';

    // Save checkpoint
    const checkpointId = await saver.putCheckpoint(checkpoint, metadata, threadId);
    expect(checkpointId).toBeDefined();

    // Retrieve checkpoint
    const retrieved = await saver.getCheckpoint(threadId, checkpointId);
    expect(retrieved).toBeDefined();
    expect((retrieved as any).bundle_id).toBe('test-bundle');
  });

  it('should scrub sensitive fields before persisting', async () => {
    const saver = new SqliteSaver();

    const checkpoint = {
      bundle_id: 'test-bundle',
      llm_api_key: 'secret-key-12345',
      search_api_key: 'another-secret',
      other_field: 'public-value',
    };

    const metadata = { parent_id: null };
    const threadId = 't2';

    // Save checkpoint
    const checkpointId = await saver.putCheckpoint(checkpoint, metadata, threadId);

    // Retrieve and verify secrets were scrubbed
    const retrieved = await saver.getCheckpoint(threadId, checkpointId);
    expect((retrieved as any).llm_api_key).toBe('[REDACTED]');
    expect((retrieved as any).search_api_key).toBe('[REDACTED]');
    expect((retrieved as any).other_field).toBe('public-value');
  });

  it('should list checkpoints for a thread', async () => {
    const saver = new SqliteSaver();

    const threadId = 't3';

    // Save multiple checkpoints
    for (let i = 0; i < 3; i++) {
      const checkpoint = { bundle_id: `test-${i}` };
      await saver.putCheckpoint(checkpoint, { parent_id: i > 0 ? `checkpoint-${i - 1}` : null }, threadId);
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // List checkpoints
    const checkpoints = await saver.listCheckpoints(threadId);
    expect(checkpoints.length).toBeGreaterThanOrEqual(3);
  });

  it('should return undefined for non-existent checkpoint', async () => {
    const saver = new SqliteSaver();

    const retrieved = await saver.getCheckpoint('nonexistent-thread', 'nonexistent-id');
    expect(retrieved).toBeUndefined();
  });

  it('should retrieve latest checkpoint when no ID specified', async () => {
    const saver = new SqliteSaver();

    const threadId = 't4';

    // Save two checkpoints
    const checkpoint1 = { bundle_id: 'first' };
    await saver.putCheckpoint(checkpoint1, {}, threadId);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const checkpoint2 = { bundle_id: 'second' };
    await saver.putCheckpoint(checkpoint2, {}, threadId);

    // Get latest (no ID specified)
    const latest = await saver.getCheckpoint(threadId);
    expect((latest as any).bundle_id).toBe('second');
  });
});
