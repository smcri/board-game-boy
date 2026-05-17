/**
 * Action bar: lists available actions from RulesDsl.
 * Renders param prompts and calls engine.dispatch(action).
 */

import React, { useState } from 'react';
import { ComponentStore } from '../engine/ecs.js';
import { GameEngine } from '../engine/index.js';
import { evaluateCondition } from '../engine/conditions.js';
import { EntityId, RulesDsl } from '@bgb/shared';

interface ActionBarProps {
  store: ComponentStore;
  engine: GameEngine;
  rulesDsl: RulesDsl;
  currentPlayer: EntityId | undefined;
}

/**
 * Render available actions and handle parameter input.
 */
export const ActionBar: React.FC<ActionBarProps> = ({
  store,
  engine,
  rulesDsl,
  currentPlayer,
}) => {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});

  // Filter actions by preconditions
  const availableActions = rulesDsl.actions.filter((action) => {
    if (!currentPlayer) return false;
    if (!action.preconditions || action.preconditions.length === 0) {
      return true;
    }
    return action.preconditions.every((cond) =>
      evaluateCondition(store, cond, currentPlayer),
    );
  });

  const currentActionDecl = selectedAction
    ? availableActions.find((a) => a.id === selectedAction)
    : null;

  const handleSubmit = async () => {
    if (!selectedAction) return;
    try {
      await engine.dispatch(selectedAction, params);
      setSelectedAction(null);
      setParams({});
    } catch (e) {
      console.error('Action failed:', e);
    }
  };

  return (
    <div
      style={{
        marginTop: '20px',
        padding: '10px',
        backgroundColor: '#f0f0f0',
        borderRadius: '4px',
      }}
    >
      <h3>Actions</h3>
      {availableActions.length === 0 ? (
        <p style={{ color: '#999' }}>No available actions</p>
      ) : (
        <div>
          <div style={{ marginBottom: '10px' }}>
            {availableActions.map((action) => (
              <button
                key={action.id}
                onClick={() => {
                  setSelectedAction(action.id);
                  setParams({});
                }}
                style={{
                  marginRight: '5px',
                  marginBottom: '5px',
                  padding: '5px 10px',
                  backgroundColor:
                    selectedAction === action.id ? '#007bff' : '#ddd',
                  color: selectedAction === action.id ? 'white' : 'black',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {action.name}
              </button>
            ))}
          </div>

          {currentActionDecl && (
            <div
              style={{
                backgroundColor: 'white',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #ccc',
              }}
            >
              <h4>{currentActionDecl.name}</h4>
              {currentActionDecl.description && (
                <p style={{ fontSize: '0.9em', color: '#666' }}>
                  {currentActionDecl.description}
                </p>
              )}

              {currentActionDecl.params && currentActionDecl.params.length > 0 ? (
                <div style={{ marginBottom: '10px' }}>
                  {currentActionDecl.params.map((param) => (
                    <div key={param.name} style={{ marginBottom: '8px' }}>
                      <label style={{ display: 'block', marginBottom: '4px' }}>
                        {param.name}:
                      </label>
                      {param.kind === 'number' ? (
                        <input
                          type="number"
                          value={(params[param.name] as number) ?? 0}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              [param.name]: parseInt(e.target.value),
                            })
                          }
                          style={{ padding: '4px', width: '100%' }}
                        />
                      ) : param.kind === 'enum' && param.options ? (
                        <select
                          value={(params[param.name] as string) ?? ''}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              [param.name]: e.target.value,
                            })
                          }
                          style={{ padding: '4px', width: '100%' }}
                        >
                          <option value="">-- Select --</option>
                          {(param.options as string[]).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={(params[param.name] as string) ?? ''}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              [param.name]: e.target.value,
                            })
                          }
                          style={{ padding: '4px', width: '100%' }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleSubmit}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Execute
                </button>
                <button
                  onClick={() => setSelectedAction(null)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
