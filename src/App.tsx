import React, { useState, useEffect, useCallback } from 'react';
import { BoardState, CellState, PlayerState, LevelConfig, RuneColor, LeaderboardEntry, Skill } from './types';
import GameBoard from './game/GameBoard';
import { ChainDetector } from './game/ChainDetector';
import { SkillManager } from './game/SkillManager';
import StatusPanel from './components/StatusPanel';
import { gameService } from './api/gameService';
import { v4 as uuidv4 } from 'uuid';

const BOARD_ROWS = 8;
const BOARD_COLS = 8;
const COLORS: RuneColor[] = ['red', 'blue', 'green'];

function createInitialBoard(levelConfig?: LevelConfig): BoardState {
  const board: BoardState = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    const row: CellState[] = [];
    for (let c = 0; c < BOARD_COLS; c++) {
      const color = levelConfig?.initialBoard?.[r]?.[c] ?? COLORS[Math.floor(Math.random() * COLORS.length)];
      row.push({
        id: uuidv4(),
        color,
        row: r,
        col: c,
      });
    }
    board.push(row);
  }
  return board;
}

function createDefaultPlayer(level: LevelConfig): PlayerState {
  return {
    score: 0,
    mana: 50,
    stepsRemaining: level.maxSteps,
    currentLevel: level.id,
    totalRunesEliminated: 0,
    selectedColor: 'red',
  };
}

const Leaderboard: React.FC<{
  entries: LeaderboardEntry[];
}> = ({ entries }) => (
  <div
    style={{
      padding: 16,
      background: 'rgba(45, 27, 78, 0.6)',
      borderRadius: 12,
      border: '1px solid rgba(139, 92, 246, 0.3)',
      minWidth: 260,
    }}
  >
    <h3 style={{ textAlign: 'center', color: '#b794f6', marginBottom: 12 }}>Leaderboard</h3>
    {entries.length === 0 && <div style={{ fontSize: 13, color: '#888', textAlign: 'center' }}>No entries yet</div>}
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ color: '#a0a0c0', borderBottom: '1px solid rgba(139,92,246,0.3)' }}>
          <th style={{ padding: 4, textAlign: 'left' }}>#</th>
          <th style={{ padding: 4, textAlign: 'left' }}>Name</th>
          <th style={{ padding: 4, textAlign: 'right' }}>Score</th>
          <th style={{ padding: 4, textAlign: 'right' }}>Lvl</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.rank} style={{ borderBottom: '1px solid rgba(139,92,246,0.1)' }}>
            <td style={{ padding: 4 }}>{e.rank}</td>
            <td style={{ padding: 4 }}>{e.playerName}</td>
            <td style={{ padding: 4, textAlign: 'right', color: '#fbd38d' }}>{e.score}</td>
            <td style={{ padding: 4, textAlign: 'right' }}>{e.levelId}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Modal: React.FC<{
  show: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}> = ({ show, title, children, onClose }) => {
  if (!show) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#2d1b4e',
          border: '2px solid rgba(139,92,246,0.5)',
          borderRadius: 16,
          padding: 32,
          minWidth: 320,
          textAlign: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ color: '#b794f6', marginBottom: 16 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [playerName, setPlayerName] = useState('Player');
  const [gameStarted, setGameStarted] = useState(false);
  const [boardState, setBoardState] = useState<BoardState>([]);
  const [playerState, setPlayerState] = useState<PlayerState>({
    score: 0,
    mana: 50,
    stepsRemaining: 30,
    currentLevel: 1,
    totalRunesEliminated: 0,
    selectedColor: 'red',
  });
  const [currentLevel, setCurrentLevel] = useState<LevelConfig | null>(null);
  const [levels, setLevels] = useState<LevelConfig[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showLevelComplete, setShowLevelComplete] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const chainDetector = new ChainDetector(BOARD_ROWS, BOARD_COLS);
  const skillManager = new SkillManager();

  useEffect(() => {
    const loadData = async () => {
      try {
        const lvlData = await gameService.getLevels();
        setLevels(lvlData);
        if (lvlData.length > 0) {
          const firstLevel = lvlData[0];
          setCurrentLevel(firstLevel);
          setBoardState(createInitialBoard(firstLevel));
          setPlayerState(createDefaultPlayer(firstLevel));
        }
      } catch {
        const fallbackLevel: LevelConfig = {
          id: 1,
          targetScore: 500,
          maxSteps: 30,
          initialBoard: null as unknown as (RuneColor | null)[][],
        };
        setCurrentLevel(fallbackLevel);
        setLevels([fallbackLevel]);
        setBoardState(createInitialBoard());
        setPlayerState({
          score: 0,
          mana: 50,
          stepsRemaining: 30,
          currentLevel: 1,
          totalRunesEliminated: 0,
          selectedColor: 'red',
        });
      }

      try {
        const lbData = await gameService.getLeaderboard();
        setLeaderboard(lbData);
      } catch {
        setLeaderboard([]);
      }
    };

    setSkills(skillManager.getSkills());
    loadData();
  }, []);

  const processChains = useCallback(
    async (board: BoardState, player: PlayerState): Promise<{ board: BoardState; player: PlayerState }> => {
      let currentBoard = board;
      let currentPlayer = { ...player };
      let hasChains = true;

      while (hasChains) {
        const chains = chainDetector.detectChains(currentBoard);
        if (chains.length === 0) {
          hasChains = false;
          break;
        }

        const scoreGain = chainDetector.calculateScore(chains);
        const runesEliminated = chains.reduce((sum, c) => sum + c.cells.length, 0);
        const manaGain = Math.floor(runesEliminated * 2);

        currentPlayer = {
          ...currentPlayer,
          score: currentPlayer.score + scoreGain,
          mana: currentPlayer.mana + manaGain,
          totalRunesEliminated: currentPlayer.totalRunesEliminated + runesEliminated,
        };

        currentBoard = chainDetector.removeChains(currentBoard, chains);
        currentBoard = chainDetector.applyGravity(currentBoard);

        for (let r = 0; r < BOARD_ROWS; r++) {
          for (let c = 0; c < BOARD_COLS; c++) {
            if (currentBoard[r][c].color === null && currentBoard[r][c].isNew) {
              currentBoard[r][c] = {
                ...currentBoard[r][c],
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                isNew: false,
              };
            }
          }
        }
      }

      return { board: currentBoard, player: currentPlayer };
    },
    [chainDetector]
  );

  const checkGameEnd = useCallback(
    (player: PlayerState) => {
      if (currentLevel && player.score >= currentLevel.targetScore) {
        setShowLevelComplete(true);
        gameService.submitScore({
          levelId: currentLevel.id,
          score: player.score,
          playerName,
          passed: true,
        }).catch(() => {});
      } else if (player.stepsRemaining <= 0) {
        setShowGameOver(true);
        gameService.submitScore({
          levelId: currentLevel?.id ?? 1,
          score: player.score,
          playerName,
          passed: false,
        }).catch(() => {});
      }
    },
    [currentLevel, playerName]
  );

  const handleCellClick = useCallback(
    async (row: number, col: number) => {
      if (isProcessing) return;
      if (boardState[row][col].color !== null) return;
      if (playerState.stepsRemaining <= 0) return;

      setIsProcessing(true);

      let newBoard = boardState.map((r) => r.map((c) => ({ ...c })));
      newBoard[row][col] = {
        ...newBoard[row][col],
        color: playerState.selectedColor,
        isAnimating: true,
      };

      const newPlayer = {
        ...playerState,
        stepsRemaining: playerState.stepsRemaining - 1,
      };

      const result = await processChains(newBoard, newPlayer);

      setBoardState(result.board);
      setPlayerState(result.player);
      checkGameEnd(result.player);
      setIsProcessing(false);
    },
    [boardState, playerState, isProcessing, processChains, checkGameEnd]
  );

  const handleSkillUse = useCallback(
    (skillId: string) => {
      if (isProcessing) return;

      const skill = skills.find((s) => s.id === skillId);
      if (!skill || !skillManager.canUseSkill(skillId, playerState.mana)) return;

      let newBoard: BoardState;

      switch (skillId) {
        case 'rune-transform':
          const otherColors = COLORS.filter((c) => c !== playerState.selectedColor);
          const toColor = otherColors[Math.floor(Math.random() * otherColors.length)];
          newBoard = skillManager.useRuneTransform(boardState, playerState.selectedColor, toColor);
          break;
        case 'rune-explode': {
          const filledCells: { row: number; col: number }[] = [];
          boardState.forEach((r) => r.forEach((c) => {
            if (c.color !== null) filledCells.push({ row: c.row, col: c.col });
          }));
          if (filledCells.length === 0) return;
          const target = filledCells[Math.floor(Math.random() * filledCells.length)];
          newBoard = skillManager.useRuneExplode(boardState, target.row, target.col);
          break;
        }
        case 'rune-shuffle':
          newBoard = skillManager.useRuneShuffle(boardState);
          break;
        default:
          return;
      }

      const newPlayer = {
        ...playerState,
        mana: playerState.mana - skill.manaCost,
      };

      setBoardState(newBoard);
      setPlayerState(newPlayer);

      setTimeout(async () => {
        const result = await processChains(newBoard, newPlayer);
        setBoardState(result.board);
        setPlayerState(result.player);
        checkGameEnd(result.player);
      }, 300);
    },
    [boardState, playerState, skills, isProcessing, skillManager, processChains, checkGameEnd]
  );

  const handleColorSelect = useCallback((color: RuneColor) => {
    setPlayerState((prev) => ({ ...prev, selectedColor: color }));
  }, []);

  const handleRestart = useCallback(() => {
    if (currentLevel) {
      setBoardState(createInitialBoard(currentLevel));
      setPlayerState(createDefaultPlayer(currentLevel));
    } else {
      setBoardState(createInitialBoard());
      setPlayerState({
        score: 0,
        mana: 50,
        stepsRemaining: 30,
        currentLevel: 1,
        totalRunesEliminated: 0,
        selectedColor: 'red',
      });
    }
    setShowLevelComplete(false);
    setShowGameOver(false);
  }, [currentLevel]);

  const handleNextLevel = useCallback(() => {
    const nextId = (currentLevel?.id ?? 0) + 1;
    const nextLevel = levels.find((l) => l.id === nextId) || {
      id: nextId,
      targetScore: (currentLevel?.targetScore ?? 500) + 300,
      maxSteps: Math.max((currentLevel?.maxSteps ?? 30) - 2, 15),
      initialBoard: null as unknown as (RuneColor | null)[][],
    };

    setCurrentLevel(nextLevel);
    setBoardState(createInitialBoard(nextLevel));
    setPlayerState({
      ...createDefaultPlayer(nextLevel),
      score: playerState.score,
      totalRunesEliminated: playerState.totalRunesEliminated,
      mana: playerState.mana,
    });
    setShowLevelComplete(false);
  }, [currentLevel, levels, playerState]);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const lbData = await gameService.getLeaderboard();
      setLeaderboard(lbData);
    } catch {
      // keep existing
    }
  }, []);

  if (!gameStarted) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}
      >
        <h1 style={{ fontSize: 42, color: '#b794f6', textShadow: '0 0 20px rgba(139,92,246,0.5)' }}>
          魔法符文铭刻
        </h1>
        <p style={{ color: '#a0a0c0', fontSize: 16 }}>Magic Rune Engraving Puzzle</p>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name"
            style={{
              padding: '10px 16px',
              background: 'rgba(45,27,78,0.8)',
              border: '1px solid rgba(139,92,246,0.5)',
              borderRadius: 8,
              color: '#e0d0f0',
              fontSize: 16,
              width: 240,
              textAlign: 'center',
            }}
          />
          <button
            onClick={() => setGameStarted(true)}
            style={{
              padding: '12px 48px',
              background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              border: 'none',
              borderRadius: 10,
              color: '#fff',
              fontSize: 18,
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(124,58,237,0.4)',
            }}
          >
            Start Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '12px 24px',
          background: 'rgba(26,11,46,0.9)',
          borderBottom: '1px solid rgba(139,92,246,0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1 style={{ fontSize: 22, color: '#b794f6' }}>魔法符文铭刻</h1>
        <span style={{ color: '#a0a0c0', fontSize: 14 }}>{playerName}</span>
      </header>

      <div style={{ flex: 1, display: 'flex', padding: 24, gap: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <GameBoard board={boardState} onCellClick={handleCellClick} selectedColor={playerState.selectedColor} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StatusPanel
            player={playerState}
            level={currentLevel}
            skills={skills}
            onSkillUse={handleSkillUse}
            onColorSelect={handleColorSelect}
            onRestart={handleRestart}
          />
          <Leaderboard entries={leaderboard} />
          <button
            onClick={refreshLeaderboard}
            style={{
              padding: '8px',
              background: 'rgba(139,92,246,0.2)',
              border: '1px solid rgba(139,92,246,0.3)',
              borderRadius: 8,
              color: '#e0d0f0',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Refresh Leaderboard
          </button>
        </div>
      </div>

      <Modal show={showLevelComplete} title="Level Complete!" onClose={() => setShowLevelComplete(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <p style={{ color: '#fbd38d', fontSize: 20 }}>Score: {playerState.score}</p>
          <p style={{ color: '#68d391' }}>Runes eliminated: {playerState.totalRunesEliminated}</p>
          <button
            onClick={handleNextLevel}
            style={{
              padding: '10px 32px',
              background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            Next Level
          </button>
        </div>
      </Modal>

      <Modal show={showGameOver} title="Game Over" onClose={() => setShowGameOver(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <p style={{ color: '#fc8181', fontSize: 18 }}>Final Score: {playerState.score}</p>
          <p style={{ color: '#a0a0c0' }}>Target was: {currentLevel?.targetScore ?? '—'}</p>
          <button
            onClick={handleRestart}
            style={{
              padding: '10px 32px',
              background: 'rgba(192,57,43,0.6)',
              border: '1px solid rgba(192,57,43,0.8)',
              borderRadius: 8,
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default App;
