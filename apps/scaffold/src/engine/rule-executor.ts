/**
 * Rule executor: deterministic switch over the 6 primitive verbs + atomic + random.
 * For atomic: snapshot, execute, restore on throw.
 * For random: use injected RNG and record results in eventLog.
 * For choose: emit choice-required event; use UI callback or window.prompt.
 */

import { ComponentStore } from './ecs.js';
import { EventLog } from './event-log.js';
import { evaluateCondition } from './conditions.js';
import { resolveSelector } from './selectors.js';
import { EntityId, ComponentName, Effect, type ComponentExpr } from '@bgb/shared';

export type ChoiceResolver = (options: unknown[]) => Promise<unknown>;

export class RuleExecutor {
  private choiceResolver: ChoiceResolver | null = null;

  registerChoiceResolver(fn: ChoiceResolver): void {
    this.choiceResolver = fn;
  }

  /**
   * Execute a single effect against the store.
   * @param store - The ECS store
   * @param effect - The effect to execute
   * @param eventLog - The event log to record randomness
   * @param rng - The RNG function
   * @param currentPlayer - Current player entity ID
   */
  async executeEffect(
    store: ComponentStore,
    effect: Effect,
    eventLog: EventLog,
    rng: () => number,
    currentPlayer: EntityId,
  ): Promise<void> {
    const eff = effect as Record<string, unknown>;
    const verb = eff.verb as string;

    if (verb === 'set') {
      const entity = await this.resolveEntityRef(store, currentPlayer, eff.entity as unknown);
      if (!entity) return;
      const comp = store.getComponent(entity, eff.component as ComponentName);
      if (comp) {
        (comp as Record<string, unknown>)[eff.field as string] = eff.value;
      }
    }

    if (verb === 'inc') {
      const entity = await this.resolveEntityRef(store, currentPlayer, eff.entity as unknown);
      if (!entity) return;
      const comp = store.getComponent(entity, eff.component as ComponentName);
      if (comp) {
        const current = (comp as Record<string, unknown>)[eff.field as string];
        if (typeof current === 'number') {
          (comp as Record<string, unknown>)[eff.field as string] = current + (eff.delta as number);
        }
      }
    }

    if (verb === 'move') {
      const entity = await this.resolveEntityRef(store, currentPlayer, eff.entity as unknown);
      if (!entity) return;
      const pos = eff.to as Record<string, unknown>;
      store.addComponent(entity, 'Position', { ...pos });
    }

    if (verb === 'choose') {
      const player = await this.resolveEntityRef(store, currentPlayer, eff.player as unknown);
      if (!player) return;
      const options = eff.options as unknown[];
      const choice = this.choiceResolver
        ? await this.choiceResolver(options)
        : window.prompt(`Choose: ${options.join(', ')}`);
      if (choice !== null) {
        const intoKey = eff.into as string | undefined;
        if (!intoKey) return;
        const meta = store.getComponent(player, 'Meta') || { json: {} };
        (meta as Record<string, unknown>).json = Object.assign(
          {},
          (meta as Record<string, unknown>).json,
          { [intoKey as string]: choice },
        );
        store.addComponent(player, 'Meta', meta);
      }
    }

    if (verb === 'if') {
      const cond = evaluateCondition(store, eff.cond as unknown, currentPlayer);
      const effects = cond
        ? (eff.then as Effect[])
        : (eff.else as Effect[] | undefined) ?? [];
      for (const e of effects) {
        await this.executeEffect(store, e, eventLog, rng, currentPlayer);
      }
    }

    if (verb === 'phase') {
      const target = eff.target as unknown;
      const phase = store.getComponent(currentPlayer, 'Phase');
      if (phase) {
        if (target === 'next') {
          // Placeholder: cycle to next phase
          (phase as Record<string, unknown>).name = 'next_phase';
        } else if (typeof target === 'object' && target !== null && 'name' in target) {
          (phase as Record<string, unknown>).name = (target as Record<string, unknown>).name;
        }
      }
    }

    if (verb === 'atomic') {
      const snapshot = store.snapshot();
      try {
        for (const step of eff.steps as Effect[]) {
          await this.executeEffect(store, step, eventLog, rng, currentPlayer);
        }
      } catch (e) {
        store.restoreFrom(snapshot);
        throw e;
      }
    }

    if (verb === 'random.roll') {
      const d = eff.d as number;
      const n = eff.n as number;
      const values: number[] = [];
      for (let i = 0; i < n; i++) {
        values.push(Math.floor(rng() * d) + 1);
      }
      // Record in event log (done by caller)
      const intoKey = eff.into as string | undefined;
      if (!intoKey) return;
      const meta = store.getComponent(currentPlayer, 'Meta') || { json: {} };
      (meta as Record<string, unknown>).json = Object.assign(
        {},
        (meta as Record<string, unknown>).json,
        { [intoKey as string]: values },
      );
      store.addComponent(currentPlayer, 'Meta', meta);
    }

    if (verb === 'random.pick') {
      const candidates = store.query(eff.from as ComponentExpr);
      const n = Math.min(eff.n as number, candidates.length);
      const picked: EntityId[] = [];
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rng() * candidates.length);
        picked.push(candidates[idx] as EntityId);
        candidates.splice(idx, 1);
      }
      const intoKey = (eff.into as string) || '';
      if (!intoKey) return;
      const meta = store.getComponent(currentPlayer, 'Meta') || { json: {} };
      const metaJson = (meta as Record<string, unknown>).json as Record<string, unknown>;
      metaJson[intoKey] = picked;
      (meta as Record<string, unknown>).json = metaJson;
      store.addComponent(currentPlayer, 'Meta', meta);
    }
  }

  /**
   * Resolve an entity reference (either EntityId or Selector).
   */
  private async resolveEntityRef(
    store: ComponentStore,
    currentPlayer: EntityId,
    ref: unknown,
  ): Promise<EntityId | undefined> {
    if (typeof ref === 'string') {
      return ref as EntityId;
    }
    const entities = resolveSelector(store, currentPlayer, ref);
    return entities[0];
  }
}
