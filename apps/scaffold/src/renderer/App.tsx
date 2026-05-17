/**
 * Root App component: composes Board + PlayerPanel + Hand + ActionBar.
 */

import React, { useEffect, useState } from 'react';
import { GameEngine, GameSnapshot } from '../engine/index.js';
import { Bundle, BoardConfig } from '@bgb/shared';
import { Board } from './Board.js';
import { PlayerPanel } from './PlayerPanel.js';
import { Hand } from './Hand.js';
import { ActionBar } from './ActionBar.js';
import './styles.css';

interface AppProps {
  engine: GameEngine;
  bundle: Bundle;
  boardConfig: BoardConfig;
}

/**
 * Root component that orchestrates the game UI.
 */
export const App: React.FC<AppProps> = ({ engine, bundle, boardConfig }) => {
  const [gameState, setGameState] = useState<GameSnapshot>(engine.getState());

  useEffect(() => {
    const unsubscribe = engine.subscribe((state) => {
      setGameState(state);
    });

    return unsubscribe;
  }, [engine]);

  const store = engine.getStore();

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>{bundle.metadata.game_name}</h1>
      <p style={{ color: '#666' }}>
        {bundle.rules_dsl.metadata.summary || 'A board game.'}
      </p>

      <Board
        store={store}
        boardConfig={boardConfig}
        currentPlayer={gameState.currentPlayer}
        storeVersion={JSON.stringify(gameState.entities)}
      />

      <PlayerPanel store={store} currentPlayer={gameState.currentPlayer} />

      <Hand store={store} currentPlayer={gameState.currentPlayer} />

      <ActionBar
        store={store}
        engine={engine}
        rulesDsl={bundle.rules_dsl}
        currentPlayer={gameState.currentPlayer}
      />

      {gameState.gameOver && (
        <div
          style={{
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#fff3cd',
            borderRadius: '4px',
            border: '1px solid #ffc107',
          }}
        >
          <h2>Game Over!</h2>
          <p>Winner: {gameState.winner}</p>
        </div>
      )}
    </div>
  );
};
