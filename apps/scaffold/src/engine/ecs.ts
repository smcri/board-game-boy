/**
 * Entity-Component-System store.
 * Components are indexed by name, then by entity ID.
 */

import {
  EntityId,
  EntityDecl,
  ComponentName,
  COMPONENT_REGISTRY,
} from '@bgb/shared';

export type ComponentData = Record<string, unknown>;

/**
 * ComponentStore: Map<componentName, Map<entityId, data>>
 */
export class ComponentStore {
  private store = new Map<ComponentName, Map<EntityId, ComponentData>>();

  /**
   * Add an entity with its initial components.
   */
  addEntity(decl: EntityDecl): void {
    const { id, components } = decl;
    for (const [name, data] of Object.entries(components)) {
      const cname = name as ComponentName;
      if (!this.store.has(cname)) {
        this.store.set(cname, new Map());
      }
      this.store.get(cname)!.set(id, data as ComponentData);
    }
  }

  /**
   * Add or overwrite a component on an entity.
   */
  addComponent(entityId: EntityId, name: ComponentName, data: ComponentData): void {
    if (!this.store.has(name)) {
      this.store.set(name, new Map());
    }
    this.store.get(name)!.set(entityId, data);
  }

  /**
   * Get a single component value.
   */
  getComponent(entityId: EntityId, name: ComponentName): ComponentData | undefined {
    return this.store.get(name)?.get(entityId);
  }

  /**
   * Get all entities with a specific component.
   */
  getEntities(componentName: ComponentName): EntityId[] {
    return Array.from(this.store.get(componentName)?.keys() ?? []);
  }

  /**
   * Get all entities matching a component expression.
   */
  query(expr: ComponentExpr): EntityId[] {
    if ('has' in expr) {
      return this.getEntities(expr.has as ComponentName);
    }
    if ('where' in expr) {
      const { component, op, value } = expr.where as {
        component: ComponentName;
        op: string;
        value: unknown;
      };
      const candidates = this.getEntities(component);
      return candidates.filter((eid) => {
        const comp = this.getComponent(eid, component);
        if (!comp) return false;
        // Simple equality check for MVP
        if (op === 'eq') {
          return JSON.stringify(comp) === JSON.stringify(value);
        }
        return false;
      });
    }
    if ('and' in expr) {
      const exprs = expr.and as ComponentExpr[];
      const sets = exprs.map((e) => new Set(this.query(e)));
      if (sets.length === 0) return [];
      const [first, ...rest] = sets;
      return Array.from(first).filter((id) => rest.every((s) => s.has(id)));
    }
    if ('or' in expr) {
      const exprs = expr.or as ComponentExpr[];
      const set = new Set<EntityId>();
      for (const e of exprs) {
        this.query(e).forEach((id) => set.add(id));
      }
      return Array.from(set);
    }
    if ('not' in expr) {
      const inner = expr.not as ComponentExpr;
      const excluded = new Set(this.query(inner));
      const all = new Set<EntityId>();
      this.store.forEach((entities) => {
        entities.forEach((_, id) => all.add(id));
      });
      return Array.from(all).filter((id) => !excluded.has(id));
    }
    return [];
  }

  /**
   * Get all entities.
   */
  all(): EntityId[] {
    const set = new Set<EntityId>();
    this.store.forEach((entities) => {
      entities.forEach((_, id) => set.add(id));
    });
    return Array.from(set);
  }

  /**
   * Validate all entities against the closed registry.
   */
  validateAll(): string[] {
    const errors: string[] = [];
    this.store.forEach((entities, cname) => {
      const schema = COMPONENT_REGISTRY[cname];
      if (!schema) {
        errors.push(`Unknown component: ${cname}`);
        return;
      }
      entities.forEach((data, eid) => {
        const result = schema.safeParse(data);
        if (!result.success) {
          errors.push(`Entity ${eid} component ${cname}: ${result.error.message}`);
        }
      });
    });
    return errors;
  }

  /**
   * Deep clone the store for atomic rollback.
   */
  snapshot(): ComponentStore {
    const clone = new ComponentStore();
    this.store.forEach((entities, cname) => {
      const clonedEntities = new Map<EntityId, ComponentData>();
      entities.forEach((data, eid) => {
        clonedEntities.set(eid, JSON.parse(JSON.stringify(data)));
      });
      clone.store.set(cname, clonedEntities);
    });
    return clone;
  }

  /**
   * Restore from a snapshot.
   */
  restoreFrom(snapshot: ComponentStore): void {
    this.store = new Map();
    snapshot.store.forEach((entities, cname) => {
      const clonedEntities = new Map<EntityId, ComponentData>();
      entities.forEach((data, eid) => {
        clonedEntities.set(eid, JSON.parse(JSON.stringify(data)));
      });
      this.store.set(cname, clonedEntities);
    });
  }
}

export type ComponentExpr = unknown;
