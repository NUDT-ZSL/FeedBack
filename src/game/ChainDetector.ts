import { BoardState, CellState, ChainGroup, RuneColor, RuneEffect } from '../types';

export class ChainDetector {
  private static effectMap: Record<RuneColor, RuneEffect> = {
    red: 'explosion',
    blue: 'lightning',
    green: 'shield',
  };

  static detectChains(board: BoardState): ChainGroup[] {
    const rows = board.length;
    const cols = board[0].length;
    const visited = new Set<string>();
    const chains: ChainGroup[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = board[r][c];
        if (cell.color !== null && !visited.has(cell.id)) {
          const connected = ChainDetector.findAllConnected(board, r, c, visited);
          if (connected.length >= 3) {
            chains.push({
              cells: connected,
              color: cell.color,
              effect: ChainDetector.effectMap[cell.color],
              chainLevel: 1,
            });
          }
        }
      }
    }

    return chains;
  }

  static eliminateChains(board: BoardState, chains: ChainGroup[]): {
    newBoard: BoardState;
    eliminated: CellState[];
    bonusMana: number;
    chainLevel: number;
    shieldActive: boolean;
  } {
    if (chains.length === 0) {
      return { newBoard: board, eliminated: [], bonusMana: 0, chainLevel: 0, shieldActive: false };
    }

    let currentBoard = ChainDetector.cloneBoard(board);
    const allEliminated: CellState[] = [];
    let bonusMana = 0;
    let currentLevel = 1;
    let currentChains = chains;
    let shieldActive = false;

    while (currentChains.length > 0 && currentLevel <= 3) {
      const toClear = new Set<string>();

      for (const chain of currentChains) {
        for (const cell of chain.cells) {
          toClear.add(`${cell.row},${cell.col}`);
        }
      }

      const redChains = currentChains.filter(c => c.effect === 'explosion');
      for (const chain of redChains) {
        for (const cell of chain.cells) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = cell.row + dr;
              const nc = cell.col + dc;
              if (nr >= 0 && nr < currentBoard.length && nc >= 0 && nc < currentBoard[0].length) {
                toClear.add(`${nr},${nc}`);
              }
            }
          }
        }
      }

      const blueChains = currentChains.filter(c => c.effect === 'lightning');
      if (blueChains.length > 0 && currentChains.length >= 2) {
        const shuffled = [...currentChains].sort(() => Math.random() - 0.5);
        const linked = shuffled.slice(0, 2);
        for (const group of linked) {
          const adjacentCells: { row: number; col: number }[] = [];
          for (const cell of group.cells) {
            const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dr, dc] of directions) {
              const nr = cell.row + dr;
              const nc = cell.col + dc;
              if (nr >= 0 && nr < currentBoard.length && nc >= 0 && nc < currentBoard[0].length) {
                const key = `${nr},${nc}`;
                if (!toClear.has(key) && currentBoard[nr][nc].color !== null) {
                  adjacentCells.push({ row: nr, col: nc });
                }
              }
            }
          }
          if (adjacentCells.length > 0) {
            const pick = adjacentCells[Math.floor(Math.random() * adjacentCells.length)];
            toClear.add(`${pick.row},${pick.col}`);
          }
        }
      }

      const greenChains = currentChains.filter(c => c.effect === 'shield');
      if (greenChains.length > 0) {
        shieldActive = true;
      }

      for (const key of toClear) {
        const [r, c] = key.split(',').map(Number);
        if (currentBoard[r][c].color !== null) {
          allEliminated.push({ ...currentBoard[r][c] });
        }
        currentBoard[r][c] = { ...currentBoard[r][c], color: null };
      }

      currentBoard = ChainDetector.applyGravity(currentBoard);

      if (currentLevel < 3) {
        currentChains = ChainDetector.detectChains(currentBoard);
        if (currentChains.length > 0) {
          currentLevel++;
          bonusMana += 10;
          currentChains = currentChains.map(c => ({ ...c, chainLevel: currentLevel }));
        }
      } else {
        currentChains = [];
      }
    }

    return { newBoard: currentBoard, eliminated: allEliminated, bonusMana, chainLevel: currentLevel, shieldActive };
  }

  static applyGravity(board: BoardState): BoardState {
    const rows = board.length;
    const cols = board[0].length;
    const newBoard: BoardState = [];

    for (let r = 0; r < rows; r++) {
      newBoard[r] = [];
      for (let c = 0; c < cols; c++) {
        newBoard[r][c] = { ...board[r][c] };
      }
    }

    for (let c = 0; c < cols; c++) {
      const nonNullCells: CellState[] = [];
      for (let r = 0; r < rows; r++) {
        if (newBoard[r][c].color !== null) {
          nonNullCells.push(newBoard[r][c]);
        }
      }
      const nullCount = rows - nonNullCells.length;
      for (let r = 0; r < nullCount; r++) {
        newBoard[r][c] = {
          id: `empty-${r}-${c}`,
          color: null,
          row: r,
          col: c,
        };
      }
      for (let i = 0; i < nonNullCells.length; i++) {
        const newRow = nullCount + i;
        newBoard[newRow][c] = {
          ...nonNullCells[i],
          row: newRow,
          col: c,
        };
      }
    }

    return newBoard;
  }

  static findAllConnected(board: BoardState, row: number, col: number, visited: Set<string>): { row: number; col: number }[] {
    const cell = board[row][col];
    if (!cell.color) return [];

    const color = cell.color;
    const result: { row: number; col: number }[] = [];
    const queue: { row: number; col: number }[] = [{ row, col }];
    visited.add(cell.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of directions) {
        const nr = current.row + dr;
        const nc = current.col + dc;
        if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
          const neighbor = board[nr][nc];
          if (neighbor.color === color && !visited.has(neighbor.id)) {
            visited.add(neighbor.id);
            queue.push({ row: nr, col: nc });
          }
        }
      }
    }

    return result;
  }

  static cloneBoard(board: BoardState): BoardState {
    return board.map(row => row.map(cell => ({ ...cell })));
  }
}
