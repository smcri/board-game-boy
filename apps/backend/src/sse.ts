/**
 * SSE event emitter per bundle_id with ring buffer.
 * Replays buffered events on client reconnect.
 */
import { EventEmitter } from 'events';
import { SseEvent } from '@bgb/shared';

const BUFFER_SIZE = 1000;

class SseEmitter extends EventEmitter {
  private buffer: SseEvent[] = [];

  emit(event: string, ...args: unknown[]): boolean {
    if (event === 'event' && args[0]) {
      const sseEvent = args[0] as SseEvent;
      // Maintain ring buffer
      this.buffer.push(sseEvent);
      if (this.buffer.length > BUFFER_SIZE) {
        this.buffer.shift();
      }
    }
    return super.emit(event, ...args);
  }

  getBuffer(): SseEvent[] {
    return [...this.buffer];
  }

  clearBuffer() {
    this.buffer = [];
  }
}

const emitters = new Map<string, SseEmitter>();

/**
 * Get or create an SSE emitter for a bundle_id.
 */
export function getSseEmitter(bundle_id: string): SseEmitter {
  if (!emitters.has(bundle_id)) {
    emitters.set(bundle_id, new SseEmitter());
  }
  return emitters.get(bundle_id)!;
}

/**
 * Emit an SSE event for a bundle_id.
 */
export function emitSseEvent(bundle_id: string, event: SseEvent) {
  const emitter = getSseEmitter(bundle_id);
  emitter.emit('event', event);
}

/**
 * Clean up emitter on build completion.
 */
export function cleanupEmitter(bundle_id: string) {
  emitters.delete(bundle_id);
}
