import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Conflict } from '@bgb/shared';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Label } from './ui/Label';

/**
 * Props for ConflictModal component.
 */
export interface ConflictModalProps {
  open: boolean;
  conflicts: Conflict[];
  onResolve: (
    decisions: Record<
      string,
      { decision: 'accept' | 'override'; value?: unknown; note?: string }
    >,
  ) => void;
}

/**
 * Radix Dialog modal for resolving core_mechanic conflicts.
 * Presents each conflict with options to accept authoritative, override, or skip.
 */
export function ConflictModal({ open, conflicts, onResolve }: ConflictModalProps) {
  const [decisions, setDecisions] = useState<
    Record<string, { decision: 'accept' | 'override'; value?: unknown; note?: string }>
  >({});

  const handleConflictDecision = (
    conflictId: string,
    decision: 'accept' | 'override',
    value?: string,
    note?: string,
  ) => {
    const entry: { decision: 'accept' | 'override'; value?: unknown; note?: string } = {
      decision,
    };
    if (value !== undefined) entry.value = value;
    if (note !== undefined) entry.note = note;

    setDecisions((prev) => ({
      ...prev,
      [conflictId]: entry,
    }));
  };

  const handleSubmit = () => {
    onResolve(decisions);
    setDecisions({});
  };

  const allDecided = conflicts.every((c) => decisions[c.id]);

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl max-w-2xl max-h-96 overflow-y-auto p-6 w-11/12">
          <Dialog.Title className="text-2xl font-bold mb-4">Resolve conflicts</Dialog.Title>

          <div className="space-y-6 mb-6">
            {conflicts.map((conflict) => (
              <div
                key={conflict.id}
                className="border border-slate-200 rounded-lg p-4 space-y-3"
              >
                <div>
                  <h4 className="font-semibold text-slate-900">{conflict.rule}</h4>
                  <p className="text-sm text-slate-600 mt-1">{conflict.description}</p>
                </div>

                {conflict.sources.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase">Sources:</p>
                    <ul className="text-xs text-slate-600 space-y-1 mt-1">
                      {conflict.sources.map((src, idx) => (
                        <li key={idx}>
                          • {src.title || src.url} ({src.source_type})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {conflict.suggested_resolution && (
                  <div className="bg-blue-50 p-3 rounded text-sm text-slate-700">
                    <strong>Suggested:</strong> {conflict.suggested_resolution}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`conflict-${conflict.id}`}
                      value="accept"
                      checked={decisions[conflict.id]?.decision === 'accept'}
                      onChange={() => handleConflictDecision(conflict.id, 'accept')}
                    />
                    <span className="text-sm">Accept authoritative</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`conflict-${conflict.id}`}
                      value="override"
                      checked={decisions[conflict.id]?.decision === 'override'}
                      onChange={() => handleConflictDecision(conflict.id, 'override')}
                    />
                    <span className="text-sm">Override with custom value</span>
                  </label>
                </div>

                {decisions[conflict.id]?.decision === 'override' && (
                  <div className="space-y-2 pl-6">
                    <div>
                      <Label htmlFor={`value-${conflict.id}`}>Custom value</Label>
                      <Input
                        id={`value-${conflict.id}`}
                        type="text"
                        placeholder="Enter custom value..."
                        onChange={(e) =>
                          handleConflictDecision(conflict.id, 'override', e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`note-${conflict.id}`}>Note (optional)</Label>
                      <Textarea
                        id={`note-${conflict.id}`}
                        placeholder="Why this override..."
                        rows={2}
                        onChange={(e) => {
                          const val = decisions[conflict.id]?.value;
                          handleConflictDecision(conflict.id, 'override', val as string, e.target.value);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <Button onClick={handleSubmit} disabled={!allDecided}>
              Submit decisions
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
