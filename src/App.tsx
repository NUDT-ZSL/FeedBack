import React, { useState, useCallback, useRef } from 'react';
import { CardConfig } from './components/CardConfig';
import { ResultsPanel } from './components/ResultsPanel';
import {
  Card,
  BattleLogEntry,
  BattleStats,
  CARD_LIBRARY,
  runSimulation,
} from './components/BattleEngine';

const TOTAL_ROUNDS = 100;

const getDefaultDeck = (): Card[] => {
  return [
    CARD_LIBRARY[0],
    CARD_LIBRARY[1],
    CARD_LIBRARY[2],
    CARD_LIBRARY[3],
    CARD_LIBRARY[4],
    CARD_LIBRARY[5],
  ];
};

const getDefaultDeckB = (): Card[] => {
  return [
    CARD_LIBRARY[6],
    CARD_LIBRARY[7],
    CARD_LIBRARY[8],
    CARD_LIBRARY[9],
    CARD_LIBRARY[10],
    CARD_LIBRARY[11],
  ];
};

const App: React.FC = () => {
  const [deckA, setDeckA] = useState<Card[]>(getDefaultDeck());
  const [deckB, setDeckB] = useState<Card[]>(getDefaultDeckB());
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<BattleLogEntry[]>([]);
  const [stats, setStats] = useState<BattleStats | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  const handleStartBattle = useCallback(() => {
    if (isRunning) return;
    if (deckA.length === 0 || deckB.length === 0) {
      alert('请先为两个卡组各添加至少一张卡牌！');
      return;
    }

    setIsRunning(true);
    runningRef.current = true;
    setProgress(0);
    setLogs([]);
    setStats(null);

    const startTime = performance.now();

    setTimeout(() => {
      const result = runSimulation(deckA, deckB, TOTAL_ROUNDS, (current, _total, lastLogs) => {
        setProgress(current);
        if (lastLogs.length > 0) {
          setLogs(prev => [...prev, ...lastLogs].slice(-200));
        }
      });

      const endTime = performance.now();
      console.log(`模拟完成，耗时: ${(endTime - startTime).toFixed(2)}ms`);

      setStats(result);
      setIsRunning(false);
      runningRef.current = false;
    }, 10);
  }, [deckA, deckB, isRunning]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>⚔️ 卡牌对战模拟器</h1>
        <p>自动对弈 · 胜率统计 · 平衡分析</p>
      </header>

      <main className="app-main">
        <div className="left-panel">
          <CardConfig
            deckA={deckA}
            deckB={deckB}
            onDeckAChange={setDeckA}
            onDeckBChange={setDeckB}
          />
        </div>

        <div className="right-panel">
          <ResultsPanel
            progress={progress}
            totalRounds={TOTAL_ROUNDS}
            logs={logs}
            stats={stats}
            isRunning={isRunning}
          />
        </div>
      </main>

      <div className="start-button-container">
        <button
          className="start-button"
          onClick={handleStartBattle}
          disabled={isRunning || deckA.length === 0 || deckB.length === 0}
        >
          {isRunning ? '模拟对战中...' : '🎮 开始对弈 (100轮)'}
        </button>
      </div>
    </div>
  );
};

export default App;
