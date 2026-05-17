/**
 * Conflict review agent: triggers HITL interrupt for core_mechanic conflicts.
 * On resume, applies user decisions to resolved conflicts.
 * See doc 05 for HITL semantics.
 */
import { BuildState } from '@bgb/shared';
import { emitSseEvent } from '../sse.js';

/**
 * Review conflicts and interrupt if core_mechanic severity detected.
 */
export async function conflictReview(state: BuildState): Promise<Partial<BuildState>> {
  const coreConflicts = (state.conflicts || []).filter((c) => c.severity === 'core_mechanic');

  if (coreConflicts.length > 0) {
    // Interrupt the graph; client must resume with decisions
    emitSseEvent(state.bundle_id, {
      type: 'interrupt',
      reason: 'core_mechanic_conflicts',
      conflicts: coreConflicts,
    });

    return {
      status: 'awaiting_review',
    };
  }

  // No core conflicts; proceed to asset generation
  if (state.user_decision) {
    // Apply user decisions to conflicts
    for (const [conflictId, decision] of Object.entries(state.user_decision)) {
      const conflict = state.conflicts?.find((c) => c.id === conflictId);
      if (conflict) {
        if (typeof decision === 'string') {
          conflict.resolution = { decision: decision as 'accept' | 'override' };
        } else if (typeof decision === 'object' && 'value' in decision) {
          conflict.resolution = {
            decision: 'override',
            value: decision.value,
            note: decision.note,
          };
        }
      }
    }
  }

  return {
    status: 'building_assets',
  };
}
