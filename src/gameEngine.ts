export type Player = 'red' | 'blue';
export type CellState = Player | null;
export type Board = CellState[][];

export interface Move {
  row: number;
  col: number;
  player: Player;
  timestamp: number;
}

export interface GameStats {
  totalMoves: number;
  redCount: number;
  blueCount: number;
  redMaxStreak: number;
  blueMaxStreak: number;
}

export interface GameResult {
  winner: Player | 'draw' | null;
  winningLine: [number, number][] | null;
  stats: GameStats;
}

export interface GameRecord {
  id: string;
  date: string;
  player1: string;
  player2: string;
  winner: Player | 'draw';
  moves: Move[];
  finalBoard: Board;
  stats: GameStats;
}

const BOARD_SIZE = 5;
const WIN_LENGTH = 5;

export class GameEngine {
  private board: Board;
  private currentPlayer: Player;
  private moves: Move[];
  private gameOver: boolean;
  private winner: Player | 'draw' | null;
  private winningLine: [number, number][] | null;

  constructor() {
    this.board = this.createEmptyBoard();
    this.currentPlayer = 'red';
    this.moves = [];
    this.gameOver = false;
    this.winner = null;
    this.winningLine = null;
  }

  private createEmptyBoard(): Board {
    return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  }

  public getBoard(): Board {
    return this.board.map(row => [...row]);
  }

  public getCurrentPlayer(): Player {
    return this.currentPlayer;
  }

  public getMoves(): Move[] {
    return [...this.moves];
  }

  public isGameOver(): boolean {
    return this.gameOver;
  }

  public getWinner(): Player | 'draw' | null {
    return this.winner;
  }

  public getWinningLine(): [number, number][] | null {
    return this.winningLine;
  }

  public makeMove(row: number, col: number): GameResult | null {
    if (this.gameOver || this.board[row][col] !== null) {
      return null;
    }

    this.board[row][col] = this.currentPlayer;
    this.moves.push({
      row,
      col,
      player: this.currentPlayer,
      timestamp: Date.now()
    });

    const winResult = this.checkWin(row, col);
    if (winResult) {
      this.gameOver = true;
      this.winner = this.currentPlayer;
      this.winningLine = winResult;
    } else if (this.moves.length === BOARD_SIZE * BOARD_SIZE) {
      this.gameOver = true;
      this.winner = 'draw';
    } else {
      this.currentPlayer = this.currentPlayer === 'red' ? 'blue' : 'red';
    }

    return {
      winner: this.winner,
      winningLine: this.winningLine,
      stats: this.getStats()
    };
  }

  private checkWin(row: number, col: number): [number, number][] | null {
    const player = this.board[row][col];
    if (!player) return null;

    const directions: [number, number][] = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1]
    ];

    for (const [dr, dc] of directions) {
      const line: [number, number][] = [[row, col]];

      for (let i = 1; i < WIN_LENGTH; i++) {
        const newRow = row + dr * i;
        const newCol = col + dc * i;
        if (this.isValidCell(newRow, newCol) && this.board[newRow][newCol] === player) {
          line.push([newRow, newCol]);
        } else {
          break;
        }
      }

      for (let i = 1; i < WIN_LENGTH; i++) {
        const newRow = row - dr * i;
        const newCol = col - dc * i;
        if (this.isValidCell(newRow, newCol) && this.board[newRow][newCol] === player) {
          line.push([newRow, newCol]);
        } else {
          break;
        }
      }

      if (line.length >= WIN_LENGTH) {
        return line;
      }
    }

    return null;
  }

  private isValidCell(row: number, col: number): boolean {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  }

  public getStats(): GameStats {
    let redCount = 0;
    let blueCount = 0;
    let redMaxStreak = 0;
    let blueMaxStreak = 0;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = this.board[row][col];
        if (cell === 'red') redCount++;
        else if (cell === 'blue') blueCount++;
      }
    }

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = this.board[row][col];
        if (cell) {
          const streak = this.getMaxStreakForCell(row, col, cell);
          if (cell === 'red') {
            redMaxStreak = Math.max(redMaxStreak, streak);
          } else {
            blueMaxStreak = Math.max(blueMaxStreak, streak);
          }
        }
      }
    }

    return {
      totalMoves: this.moves.length,
      redCount,
      blueCount,
      redMaxStreak,
      blueMaxStreak
    };
  }

  private getMaxStreakForCell(row: number, col: number, player: Player): number {
    const directions: [number, number][] = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1]
    ];

    let maxStreak = 0;

    for (const [dr, dc] of directions) {
      let count = 1;

      for (let i = 1; i < WIN_LENGTH; i++) {
        const newRow = row + dr * i;
        const newCol = col + dc * i;
        if (this.isValidCell(newRow, newCol) && this.board[newRow][newCol] === player) {
          count++;
        } else {
          break;
        }
      }

      for (let i = 1; i < WIN_LENGTH; i++) {
        const newRow = row - dr * i;
        const newCol = col - dc * i;
        if (this.isValidCell(newRow, newCol) && this.board[newRow][newCol] === player) {
          count++;
        } else {
          break;
        }
      }

      maxStreak = Math.max(maxStreak, count);
    }

    return maxStreak;
  }

  public createGameRecord(player1: string, player2: string): GameRecord | null {
    if (!this.gameOver || !this.winner) return null;

    return {
      id: `game_${Date.now()}`,
      date: new Date().toLocaleString('zh-CN'),
      player1,
      player2,
      winner: this.winner,
      moves: [...this.moves],
      finalBoard: this.getBoard(),
      stats: this.getStats()
    };
  }

  public reset(): void {
    this.board = this.createEmptyBoard();
    this.currentPlayer = 'red';
    this.moves = [];
    this.gameOver = false;
    this.winner = null;
    this.winningLine = null;
  }
}
