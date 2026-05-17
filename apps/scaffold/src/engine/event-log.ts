/**
 * Append-only event log for game actions.
 * Supports replay and undo operations.
 */

import { ComponentStore } from './ecs.js';
import { EventLogEntry } from '@bgb/shared';

export class EventLog {
  private entries: EventLogEntry[] = [];

  /**
   * Append a new event to the log.
   */
  append(entry: EventLogEntry): void {
    this.entries.push(entry);
  }

  /**
   * Get all entries.
   */
  getAll(): EventLogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entry at index.
   */
  get(index: number): EventLogEntry | undefined {
    return this.entries[index];
  }

  /**
   * Get length.
   */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Undo: remove the last entry and return it.
   */
  undo(): EventLogEntry | undefined {
    return this.entries.pop();
  }

  /**
   * Replay: rebuild state by replaying log up to (and including) a given index.
   * Caller must repopulate the store with initial entities before calling this.
   * (This is a placeholder; actual replay is integrated into the engine's dispatch loop.)
   */
  replay(store: ComponentStore, fromIndex: number): void {
    // Reset store and re-apply effects up to fromIndex.
    // This is called by the engine after undo.
  }

  /**
   * Clear the log.
   */
  clear(): void {
    this.entries = [];
  }
}
