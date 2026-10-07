import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Board from './Board';
import Panel from './Panel';
import type {
  Piece,
  FormationType,
  SimulationResult,
  HistoryItem,
  MoraleState,
} from './types';
import { COLORS, BOARD_SIZE, CELL_SIZE, GamePhase } from './types';
import {
  initializePieces,
  buildHistoryItem,
  pushHistory,
  createInitialMorale,
  resultFromHistoryItem,
} from './GameSimulation';
import { loadFromUrl } from './ExportTool';
import '@/index.css';

const App: React.FC = () => {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [phase, setPhase] = useState<GamePhase>(GamePhase.IDLE);
  const [playerFormation, setPlayerFormation] = useState<FormationType | null>(null);
  const [aiFormation, setAiFormation] = useState<FormationType | null>(null);
  const [morale, setMorale] = useState<MoraleState>(createInitialMorale);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [formationToApply, setFormationToApply] = useState<FormationType | null>(null);
  const [scale, setScale] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedData = loadFromUrl();
    if (savedData) {
      setPieces(savedData.pieces);
      setPlayerFormation(savedData.playerFormation);
      setAiFormation(savedData.aiFormation);
    } else {
      setPieces(initializePieces());
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth - 464;
      const boardWidth = BOARD_SIZE * CELL_SIZE;
      const newScale = Math.max(0.5, Math.min(1, containerWidth / boardWidth));
      setScale(newScale);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSelectFormation = useCallback((formation: FormationType) => {
    if (phase !== GamePhase.IDLE && phase !== GamePhase.FINISHED) return;
    if (phase === GamePhase.FINISHED) {
      setPieces(initializePieces());
      setResult(null);
    }
    setFormationToApply(formation);
  }, [phase]);

  const handleFormationApplied = useCallback(() => {
    setFormationToApply(null);
  }, []);

  const handleSimulationStart = useCallback(() => {
    setResult(null);
  }, []);

  const handleBattleComplete = useCallback((battleResult: SimulationResult) => {
    setResult(battleResult);
    setMorale({ player: battleResult.playerMoraleEnd, ai: battleResult.aiMoraleEnd });
    setHistory((prev) => pushHistory(prev, buildHistoryItem(battleResult, uuidv4())));
  }, []);

  const handleReset = useCallback(() => {
    setPieces(initializePieces());
    setPhase(GamePhase.IDLE);
    setPlayerFormation(null);
    setAiFormation(null);
    setMorale(createInitialMorale());
    setResult(null);
    setFormationToApply(null);
  }, []);

  const handleRestoreHistory = useCallback((item: HistoryItem) => {
    if (phase !== GamePhase.IDLE && phase !== GamePhase.FINISHED) return;
    setPieces(JSON.parse(JSON.stringify(item.snapshot)));
    setMorale({ player: item.playerMoraleEnd, ai: item.aiMoraleEnd });
    setPlayerFormation(item.playerFormation as FormationType);
    setAiFormation(item.aiFormation as FormationType);
    setResult(resultFromHistoryItem(item));
    setFormationToApply(null);
    setPhase(GamePhase.FINISHED);
  }, [phase]);

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full flex flex-col"
      style={{
        backgroundColor: COLORS.parchment,
        backgroundImage: `
          linear-gradient(to right, ${COLORS.darkBrown}00, ${COLORS.darkBrown}33 5%, ${COLORS.darkBrown}00 15%, ${COLORS.darkBrown}00 85%, ${COLORS.darkBrown}33 95%, ${COLORS.darkBrown}00),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.03) 2px,
            rgba(0,0,0,0.03) 4px
          )
        `,
      }}
    >
      <header
        className="py-4 text-center relative"
        style={{
          background: `linear-gradient(to bottom, ${COLORS.darkBrown}, transparent)`,
          borderBottom: `3px solid ${COLORS.gold}`,
        }}
      >
        <h1
          className="text-4xl font-bold"
          style={{
            fontFamily: '"Ma Shan Zheng", serif',
            color: COLORS.gold,
            textShadow: `2px 2px 4px rgba(0,0,0,0.5)`,
          }}
        >
          古 代 阵 法 推 演
        </h1>
        <div
          className="text-sm mt-1"
          style={{
            fontFamily: '"Ma Shan Zheng", serif',
            color: COLORS.parchment,
            opacity: 0.8,
          }}
        >
          运筹帷幄之中，决胜千里之外
        </div>
      </header>

      <main className="flex-1 flex items-stretch overflow-hidden">
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          <div
            className="relative rounded-lg overflow-hidden shadow-2xl"
            style={{
              minWidth: Math.min(BOARD_SIZE * CELL_SIZE * scale, BOARD_SIZE * CELL_SIZE),
              boxShadow: `
                0 0 30px rgba(0,0,0,0.5),
                inset 0 0 60px ${COLORS.darkBrown}40
              `,
              border: `4px solid ${COLORS.gold}`,
            }}
          >
            <Board
              pieces={pieces}
              setPieces={setPieces}
              morale={morale}
              setMorale={setMorale}
              phase={phase}
              setPhase={setPhase}
              playerFormation={playerFormation}
              setPlayerFormation={setPlayerFormation}
              aiFormation={aiFormation}
              setAiFormation={setAiFormation}
              formationToApply={formationToApply}
              onFormationApplied={handleFormationApplied}
              onSimulationStart={handleSimulationStart}
              onBattleComplete={handleBattleComplete}
              scale={scale}
              boardRef={boardRef}
            />
          </div>
        </div>

        <Panel
          pieces={pieces}
          playerFormation={playerFormation}
          aiFormation={aiFormation}
          result={result}
          history={history}
          phase={phase}
          playerMorale={morale.player}
          aiMorale={morale.ai}
          onSelectFormation={handleSelectFormation}
          onReset={handleReset}
          onRestoreHistory={handleRestoreHistory}
        />
      </main>

      <footer
        className="py-2 text-center"
        style={{
          background: `linear-gradient(to top, ${COLORS.darkBrown}, transparent)`,
          borderTop: `2px solid ${COLORS.gold}`,
        }}
      >
        <div
          className="text-xs"
          style={{
            fontFamily: '"Ma Shan Zheng", serif',
            color: COLORS.parchment,
            opacity: 0.7,
          }}
        >
          拖拽棋子布阵 · 点击阵法排列 · 开始推演对战
        </div>
      </footer>
    </div>
  );
};

export default App;
