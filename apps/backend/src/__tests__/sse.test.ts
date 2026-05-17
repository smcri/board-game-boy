/**
 * Tests for SSE emitter: ring buffer + replay behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getSseEmitter, emitSseEvent } from '../sse.js';
import { SseEvent } from '@bgb/shared';

describe('SSE Emitter', () => {
  beforeEach(() => {
    // Clear emitters before each test
  });

  it('should emit and buffer events', () => {
    const emitter = getSseEmitter('test-bundle-1');
    const events: SseEvent[] = [];

    emitter.on('event', (e: SseEvent) => {
      events.push(e);
    });

    const testEvent: SseEvent = {
      type: 'update',
      status: 'classifying',
      node: 'classify',
      message: 'Starting',
    };

    emitSseEvent('test-bundle-1', testEvent);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(testEvent);
  });

  it('should replay buffered events on reconnect', () => {
    const emitter1 = getSseEmitter('test-bundle-2');
    const event1: SseEvent = {
      type: 'update',
      status: 'fetching',
      node: 'rules_agent',
    };
    const event2: SseEvent = {
      type: 'search',
      provider: 'tavily',
      query: 'chess',
      hits: 10,
    };

    emitSseEvent('test-bundle-2', event1);
    emitSseEvent('test-bundle-2', event2);

    const buffer = emitter1.getBuffer();
    expect(buffer).toHaveLength(2);
    expect(buffer[0]).toEqual(event1);
    expect(buffer[1]).toEqual(event2);

    // Simulate reconnect
    const emitter2 = getSseEmitter('test-bundle-2');
    const buffer2 = emitter2.getBuffer();
    expect(buffer2).toEqual(buffer);
  });

  it('should maintain ring buffer limit', () => {
    const emitter = getSseEmitter('test-bundle-3');

    // Emit more than buffer size (1000)
    for (let i = 0; i < 1100; i++) {
      emitSseEvent('test-bundle-3', {
        type: 'update',
        status: 'classifying',
        node: 'test',
        data: { index: i },
      });
    }

    const buffer = emitter.getBuffer();
    expect(buffer.length).toBeLessThanOrEqual(1000);
  });
});
