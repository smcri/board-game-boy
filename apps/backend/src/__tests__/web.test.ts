/**
 * Tests for web module: bucket classification + cache get/put.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bucketByPriority } from '../web/bucket.js';
import { classifySourceType } from '../web/fetcher.js';
import Database from 'better-sqlite3';
import { cacheGet, cachePut } from '../db.js';

describe('Web Module', () => {
  describe('Source Type Classification', () => {
    it('should classify PDF URLs', () => {
      expect(classifySourceType('https://fide.com/files/Rules_of_Chess.pdf')).toBe('pdf');
      expect(classifySourceType('https://example.com/doc.pdf')).toBe('pdf');
    });

    it('should classify publisher URLs', () => {
      expect(classifySourceType('https://uschess.org/rules')).toBe('publisher');
      expect(classifySourceType('https://fide.com/about')).toBe('publisher');
      expect(classifySourceType('https://hasbro.com/games')).toBe('publisher');
    });

    it('should classify BoardGameGeek URLs', () => {
      expect(classifySourceType('https://boardgamegeek.com/boardgame/13/carcassonne')).toBe('bgg');
    });

    it('should classify fan URLs as default', () => {
      expect(classifySourceType('https://fansite.com/rules')).toBe('fan');
      expect(classifySourceType('https://reddit.com/r/boardgames')).toBe('fan');
    });
  });

  describe('Bucket Classification', () => {
    it('should bucket hits by priority', () => {
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

    it('should order buckets by priority (pdf > publisher > bgg > fan)', () => {
      const hits = [
        { url: 'https://fansite.com/1', title: 'Fan 1' },
        { url: 'https://example.pdf', title: 'PDF' },
        { url: 'https://hasbro.com/rules', title: 'Publisher' },
      ];

      const bucketed = bucketByPriority(hits);

      // Priority order: PDF, Publisher, BGG, Fan
      const priorities = [];
      if (bucketed.pdf.length > 0) priorities.push('pdf');
      if (bucketed.publisher.length > 0) priorities.push('publisher');
      if (bucketed.bgg.length > 0) priorities.push('bgg');
      if (bucketed.fan.length > 0) priorities.push('fan');

      expect(priorities[0]).toBe('pdf');
    });
  });

  describe('Cache', () => {
    it('should store and retrieve cached content', () => {
      const url = 'https://example.com/test';
      const content = 'Test content here';
      const source_type = 'fan';

      cachePut(url, content, source_type);
      const cached = cacheGet(url);

      expect(cached).toBeDefined();
      expect(cached?.content).toBe(content);
      expect(cached?.source_type).toBe(source_type);
    });

    it('should handle cache miss', () => {
      const cached = cacheGet('https://nonexistent-url-12345.example.com');
      expect(cached).toBeNull();
    });

    it('should update cache on re-put', () => {
      const url = 'https://example.com/update-test';

      cachePut(url, 'First content');
      let cached = cacheGet(url);
      expect(cached?.content).toBe('First content');

      cachePut(url, 'Updated content');
      cached = cacheGet(url);
      expect(cached?.content).toBe('Updated content');
    });
  });
});
