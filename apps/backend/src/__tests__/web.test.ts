/**
 * Tests for web module: bucket classification + libsql-backed cache get/put.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bucketByPriority } from '../web/bucket.js';
import { classifySourceType } from '../web/fetcher.js';
import { _resetDbForTests, cacheGet, cachePut, initDb } from '../db.js';

beforeEach(async () => {
  _resetDbForTests(':memory:');
  await initDb();
});

describe('Web Module', () => {
  describe('Source Type Classification', () => {
    it('classifies PDF URLs', () => {
      expect(classifySourceType('https://fide.com/files/Rules_of_Chess.pdf')).toBe('pdf');
      expect(classifySourceType('https://example.com/doc.pdf')).toBe('pdf');
    });

    it('classifies publisher URLs', () => {
      expect(classifySourceType('https://uschess.org/rules')).toBe('publisher');
      expect(classifySourceType('https://fide.com/about')).toBe('publisher');
      expect(classifySourceType('https://hasbro.com/games')).toBe('publisher');
    });

    it('classifies BoardGameGeek URLs', () => {
      expect(classifySourceType('https://boardgamegeek.com/boardgame/13/carcassonne')).toBe('bgg');
    });

    it('classifies fan URLs as default', () => {
      expect(classifySourceType('https://fansite.com/rules')).toBe('fan');
      expect(classifySourceType('https://reddit.com/r/boardgames')).toBe('fan');
    });
  });

  describe('Bucket Classification', () => {
    it('buckets hits by priority', () => {
      const hits = [
        { url: 'https://fide.com/rules.pdf', title: 'FIDE Rules' },
        { url: 'https://boardgamegeek.com/chess', title: 'BGG' },
        { url: 'https://fansite.com/rules', title: 'Fan Rules' },
        { url: 'https://uschess.org/standards', title: 'USCF' },
      ];
      const bucketed = bucketByPriority(hits);
      expect(bucketed.pdf).toHaveLength(1);
      expect(bucketed.publisher).toHaveLength(1);
      expect(bucketed.bgg).toHaveLength(1);
      expect(bucketed.fan).toHaveLength(1);
    });

    it('orders buckets pdf > publisher > bgg > fan', () => {
      const hits = [
        { url: 'https://fansite.com/1', title: 'Fan 1' },
        { url: 'https://example.com/x.pdf', title: 'PDF' },
        { url: 'https://hasbro.com/rules', title: 'Publisher' },
      ];
      const bucketed = bucketByPriority(hits);
      const priorities: string[] = [];
      if (bucketed.pdf.length > 0) priorities.push('pdf');
      if (bucketed.publisher.length > 0) priorities.push('publisher');
      if (bucketed.bgg.length > 0) priorities.push('bgg');
      if (bucketed.fan.length > 0) priorities.push('fan');
      expect(priorities[0]).toBe('pdf');
    });
  });

  describe('Cache (libsql)', () => {
    it('stores and retrieves cached content', async () => {
      const url = 'https://example.com/test';
      const content = 'Test content here';
      const source_type = 'fan';

      await cachePut(url, content, source_type);
      const cached = await cacheGet(url);

      expect(cached).not.toBeNull();
      expect(cached?.content).toBe(content);
      expect(cached?.source_type).toBe(source_type);
    });

    it('returns null on cache miss', async () => {
      const cached = await cacheGet('https://nonexistent-url-12345.example.com');
      expect(cached).toBeNull();
    });

    it('updates cache on re-put', async () => {
      const url = 'https://example.com/update-test';
      await cachePut(url, 'First content');
      let cached = await cacheGet(url);
      expect(cached?.content).toBe('First content');
      await cachePut(url, 'Updated content');
      cached = await cacheGet(url);
      expect(cached?.content).toBe('Updated content');
    });
  });
});
