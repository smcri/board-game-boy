/**
 * Main engine: wires store + rule-executor + event log + systems.
 * Exposes: dispatch(action), getState(), subscribe(listener), undo(), replay(events), registerChoiceResolver(fn).
 */

import { ComponentStore } from './ecs.js';
import { RuleExecutor, ChoiceResolver } from './rule-executor.js';
import { EventLog } from './event-log.js';
import { runSystems, getCurrentPlayer } from './systems.js';
import { createRNG, hashSeed } from './rng.js';
import { Bundle, EntityId, ActionDecl, EventLogEntry } from '@bgb/shared';

export type Listener = (state: GameSnapshot) => void;

export interface GameSnapshot {
  entities: Record<EntityId, Record<string, unknown>>;
  currentPlayer: EntityId | undefined;
  winner?: EntityId;
  gameOver: boolean;
}

/**
 * Engine: the main game state machine.
 */
export class GameEngine {
  private store: ComponentStore;
  private executor: RuleExecutor;
  private eventLog: EventLog;
  private listeners: Set<Listener> = new Set();
  private bundle: Bundle;
  private rng: () => number;

  constructor(bundle: Bundle) {
    this.bundle = bundle;
    this.store = new ComponentStore();
    this.executor = new RuleExecutor();
    this.eventLog = new EventLog();

    // Seed RNG from bundle_id
    const seed = hashSeed(bundle.bundle_id);
    this.rng = createRNG(seed);

    // Initialize entities
    for (const decl of bundle.rules_dsl.entities) {
      this.store.addEntity(decl);
    }

    const errors = this.store.validateAll();
    if (errors.length > 0) {
      console.warn('Store validation errors:', errors);
    }

    this.notifyListeners();
  }

  /**
   * Register a choice resolver callback.
   */
  registerChoiceResolver(fn: ChoiceResolver): void {
    this.executor.registerChoiceResolver(fn);
  }

  /**
   * Dispatch an action with parameters.
   */
  async dispatch(actionId: string, params?: Record<string, unknown>): Promise<void> {
    const action = this.bundle.rules_dsl.actions.find((a) => a.id === actionId);
    if (!action) {
      console.error(`Action not found: ${actionId}`);
      return;
    }

    const currentPlayer = getCurrentPlayer(this.store);
    if (!currentPlayer) {
      console.error('No current player');
      return;
    }

    // Check preconditions
    if (action.preconditions && action.preconditions.length > 0) {
      const { evaluateCondition } = await import('./conditions.js');
      const allMet = action.preconditions.every((cond) =>
        evaluateCondition(this.store, cond, currentPlayer),
      );
      if (!allMet) {
        console.warn(`Preconditions not met for action ${actionId}`);
        return;
      }
    }

    // Execute effects
    try {
      for (const effect of action.effect) {
        await this.executor.executeEffect(
          this.store,
          effect,
          this.eventLog,
          this.rng,
          currentPlayer,
        );
      }
    } catch (e) {
      console.error(`Effect execution failed: ${e}`);
      return;
    }

    // Log event
    const entry: EventLogEntry = {
      ts: Date.now(),
      action_id: actionId,
      player_entity: currentPlayer,
      effects_applied: action.effect,
    };
    this.eventLog.append(entry);

    // Run systems (turn advance, win condition check, etc.)
    const gameState = runSystems(this.store, this.bundle.rules_dsl);
    if (gameState.gameOver) {
      console.log(`Game over! Winner: ${gameState.winner}`);
    }

    this.notifyListeners();
  }

  /**
   * Get current game state snapshot.
   */
  getState(): GameSnapshot {
    const entities: Record<EntityId, Record<string, unknown>> = {};
    const allEntities = this.store.all();

    for (const eid of allEntities) {
      entities[eid] = {};
      // Get all components for this entity by checking all component names
      const componentNames = [
        'Identity', 'Player', 'Owner', 'Counter', 'Position', 'Adjacency',
        'BoardNode', 'Card', 'Deck', 'Hand', 'Tile', 'Token', 'Phase',
        'Turn', 'Visibility', 'Meta',
      ] as const;
      
      for (const cname of componentNames) {
        const comp = this.store.getComponent(eid, cname);
        if (comp) {
          (entities[eid] as Record<string, unknown>)[cname] = comp;
        }
      }
    }

    const currentPlayer = getCurrentPlayer(this.store);

    return {
      entities,
      currentPlayer,
      gameOver: false,
    };
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Undo the last action (remove from log and replay).
   */
  undo(): void {
    const entry = this.eventLog.undo();
    if (!entry) {
      console.log('Nothing to undo');
      return;
    }

    // Reinitialize store and replay log
    this.store = new ComponentStore();
    for (const decl of this.bundle.rules_dsl.entities) {
      this.store.addEntity(decl);
    }

    // Replay all remaining events
    for (let i = 0; i < this.eventLog.length; i++) {
      // (Deferred: actually replay effects)
    }

    this.notifyListeners();
  }

  /**
   * Replay events from the log.
   */
  replay(fromIndex: number): void {
    // Reinitialize and replay up to fromIndex
    this.store = new ComponentStore();
    for (const decl of this.bundle.rules_dsl.entities) {
      this.store.addEntity(decl);
    }
    // (Deferred: actually replay)
    this.notifyListeners();
  }

  /**
   * Get the underlying store for testing/direct access.
   */
  getStore(): ComponentStore {
    return this.store;
  }

  private notifyListeners(): void {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

/**
 * Create an engine from a bundle.
 */
export function createEngine(bundle: Bundle): GameEngine {
  return new GameEngine(bundle);
}
