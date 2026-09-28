import { Router } from 'express';
import { LevelConfig, RuneColor } from '../../src/types';

const router = Router();

function createBoard(size: number, prePlaced: number): (RuneColor | null)[][] {
  const board: (RuneColor | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );
  const colors: RuneColor[] = ['red', 'blue', 'green'];
  const positions: [number, number][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      positions.push([r, c]);
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  let placed = 0;
  for (let i = 0; i < positions.length && placed < prePlaced; i++) {
    const [r, c] = positions[i];
    let color: RuneColor;
    if (c > 0 && board[r][c - 1] !== null) {
      color = board[r][c - 1]!;
      if (Math.random() < 0.4) {
        color = colors[Math.floor(Math.random() * 3)];
      }
    } else if (r > 0 && board[r - 1][c] !== null) {
      color = board[r - 1][c]!;
      if (Math.random() < 0.4) {
        color = colors[Math.floor(Math.random() * 3)];
      }
    } else {
      color = colors[Math.floor(Math.random() * 3)];
    }
    board[r][c] = color;
    placed++;
  }
  return board;
}

const levels: LevelConfig[] = [
  { id: 1, targetScore: 300, maxSteps: 25, initialBoard: createBoard(6, 8) },
  { id: 2, targetScore: 350, maxSteps: 24, initialBoard: createBoard(6, 10) },
  { id: 3, targetScore: 400, maxSteps: 23, initialBoard: createBoard(6, 12) },
  { id: 4, targetScore: 450, maxSteps: 22, initialBoard: createBoard(6, 14) },
  { id: 5, targetScore: 500, maxSteps: 21, initialBoard: createBoard(6, 16) },
  { id: 6, targetScore: 550, maxSteps: 20, initialBoard: createBoard(6, 18) },
  { id: 7, targetScore: 600, maxSteps: 19, initialBoard: createBoard(6, 20) },
  { id: 8, targetScore: 650, maxSteps: 18, initialBoard: createBoard(6, 22) },
  { id: 9, targetScore: 700, maxSteps: 17, initialBoard: createBoard(6, 24) },
  { id: 10, targetScore: 800, maxSteps: 15, initialBoard: createBoard(6, 26) },
];

router.get('/', (_req, res) => {
  res.json(levels);
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const level = levels.find(l => l.id === id);
  if (!level) {
    res.status(404).json({ error: 'Level not found' });
    return;
  }
  res.json(level);
});

export default router;
