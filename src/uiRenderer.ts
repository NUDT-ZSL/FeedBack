import type { Board, Player, GameStats, GameRecord, Move } from './gameEngine';

const BOARD_SIZE = 5;

export class UIRenderer {
  private boardElement: HTMLElement;
  private currentPlayerDot: HTMLElement;
  private victoryBanner: HTMLElement;
  private historyList: HTMLElement;
  private sidebar: HTMLElement;
  private sidebarOverlay: HTMLElement;
  private audioContext: AudioContext | null = null;
  private statsElements: {
    totalMoves: HTMLElement;
    redCount: HTMLElement;
    blueCount: HTMLElement;
    redMaxStreak: HTMLElement;
    blueMaxStreak: HTMLElement;
  };
  private cellElements: HTMLElement[][] = [];
  private previousStats: GameStats = {
    totalMoves: 0,
    redCount: 0,
    blueCount: 0,
    redMaxStreak: 0,
    blueMaxStreak: 0
  };

  constructor() {
    this.boardElement = document.getElementById('board') as HTMLElement;
    this.currentPlayerDot = document.getElementById('currentPlayerDot') as HTMLElement;
    this.victoryBanner = document.getElementById('victoryBanner') as HTMLElement;
    this.historyList = document.getElementById('historyList') as HTMLElement;
    this.sidebar = document.getElementById('sidebar') as HTMLElement;
    this.sidebarOverlay = document.getElementById('sidebarOverlay') as HTMLElement;
    this.statsElements = {
      totalMoves: document.getElementById('totalMoves') as HTMLElement,
      redCount: document.getElementById('redCount') as HTMLElement,
      blueCount: document.getElementById('blueCount') as HTMLElement,
      redMaxStreak: document.getElementById('redMaxStreak') as HTMLElement,
      blueMaxStreak: document.getElementById('blueMaxStreak') as HTMLElement
    };

    this.initAudioContext();
  }

  private initAudioContext(): void {
    const initAudio = () => {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
    };
    document.addEventListener('click', initAudio, { once: true });
    document.addEventListener('keydown', initAudio, { once: true });
  }

  public playDropSound(): void {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(300, this.audioContext.currentTime);

    gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.1);
  }

  public createBoard(onCellClick: (row: number, col: number) => void): void {
    this.boardElement.innerHTML = '';
    this.cellElements = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
      this.cellElements[row] = [];
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = row.toString();
        cell.dataset.col = col.toString();

        const previewPiece = document.createElement('div');
        previewPiece.className = 'preview-piece red';
        cell.appendChild(previewPiece);

        cell.addEventListener('click', () => onCellClick(row, col));
        this.boardElement.appendChild(cell);
        this.cellElements[row][col] = cell;
      }
    }
  }

  public updateBoard(board: Board): void {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = this.cellElements[row][col];
        const existingPiece = cell.querySelector('.piece');
        const previewPiece = cell.querySelector('.preview-piece') as HTMLElement;
        const cellValue = board[row][col];

        if (cellValue && !existingPiece) {
          const piece = document.createElement('div');
          piece.className = `piece ${cellValue} dropping`;
          cell.appendChild(piece);
          this.playDropSound();

          setTimeout(() => {
            piece.classList.remove('dropping');
          }, 400);

          if (previewPiece) {
            previewPiece.style.display = 'none';
          }
        }
      }
    }
  }

  public updatePreviewPiece(player: Player): void {
    const previewPieces = document.querySelectorAll('.preview-piece');
    previewPieces.forEach(piece => {
      piece.classList.remove('red', 'blue');
      piece.classList.add(player);
    });
  }

  public updateCurrentPlayer(player: Player): void {
    this.currentPlayerDot.classList.remove('red', 'blue');
    this.currentPlayerDot.classList.add(player);
  }

  public updateStats(stats: GameStats): void {
    const statKeys: (keyof GameStats)[] = ['totalMoves', 'redCount', 'blueCount', 'redMaxStreak', 'blueMaxStreak'];

    statKeys.forEach(key => {
      const element = this.statsElements[key];
      const oldValue = this.previousStats[key];
      const newValue = stats[key];

      if (oldValue !== newValue) {
        element.textContent = newValue.toString();
        element.classList.remove('rolling');
        void element.offsetWidth;
        element.classList.add('rolling');

        setTimeout(() => {
          element.classList.remove('rolling');
        }, 300);
      }
    });

    this.previousStats = { ...stats };
  }

  public showVictory(winner: Player | 'draw', winningLine: [number, number][] | null): void {
    if (winner === 'draw') {
      this.victoryBanner.textContent = '平局！';
    } else {
      const winnerName = winner === 'red' ? '玩家1（红）' : '玩家2（蓝）';
      this.victoryBanner.textContent = `${winnerName}胜利！`;
    }

    this.victoryBanner.classList.add('show');

    if (winningLine && winner !== 'draw') {
      const allPieces = document.querySelectorAll('.piece');
      allPieces.forEach(piece => {
        piece.classList.add('faded');
      });

      winningLine.forEach(([row, col], index) => {
        const cell = this.cellElements[row][col];
        const piece = cell.querySelector('.piece');
        if (piece) {
          setTimeout(() => {
            piece.classList.remove('faded');
            piece.classList.add('winning');
          }, index * 100);
        }
      });
    }
  }

  public hideVictory(): void {
    this.victoryBanner.classList.remove('show');
  }

  public resetBoard(): void {
    this.cellElements.forEach(row => {
      row.forEach(cell => {
        const piece = cell.querySelector('.piece');
        if (piece) {
          piece.remove();
        }
        const previewPiece = cell.querySelector('.preview-piece') as HTMLElement;
        if (previewPiece) {
          previewPiece.style.display = '';
          previewPiece.className = 'preview-piece red';
        }
      });
    });
  }

  public openSidebar(): void {
    this.sidebar.classList.add('active');
    this.sidebarOverlay.classList.add('active');
  }

  public closeSidebar(): void {
    this.sidebar.classList.remove('active');
    this.sidebarOverlay.classList.remove('active');
  }

  public renderHistory(records: GameRecord[]): void {
    if (records.length === 0) {
      this.historyList.innerHTML = '<div class="empty-state">暂无对局记录</div>';
      return;
    }

    this.historyList.innerHTML = '';

    records.forEach(record => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.dataset.id = record.id;

      const header = document.createElement('div');
      header.className = 'history-item-header';
      header.innerHTML = `
        <div>
          <div class="history-date">${record.date}</div>
          <div class="history-players">${record.player1} vs ${record.player2}</div>
        </div>
        <div class="history-winner">
          ${record.winner === 'draw' ? '平局' : (record.winner === 'red' ? record.player1 : record.player2) + ' 胜'}
        </div>
      `;

      const details = document.createElement('div');
      details.className = 'history-item-details';

      const detailsContent = document.createElement('div');
      detailsContent.className = 'history-details-content';

      const stepsContainer = document.createElement('div');
      stepsContainer.className = 'history-steps';

      record.moves.forEach((move, index) => {
        const step = document.createElement('div');
        step.className = `history-step ${move.player}`;
        step.textContent = (index + 1).toString();
        step.dataset.stepIndex = index.toString();
        stepsContainer.appendChild(step);
      });

      const miniBoard = this.createMiniBoard(record.moves);

      detailsContent.appendChild(stepsContainer);
      detailsContent.appendChild(miniBoard);
      details.appendChild(detailsContent);

      item.appendChild(header);
      item.appendChild(details);

      header.addEventListener('click', (e) => {
        e.stopPropagation();
        item.classList.toggle('expanded');
      });

      const stepElements = stepsContainer.querySelectorAll('.history-step');
      const miniCells = miniBoard.querySelectorAll('.mini-cell');

      stepElements.forEach(stepEl => {
        const stepElement = stepEl as HTMLElement;
        const stepIndex = parseInt(stepElement.dataset.stepIndex || '0');

        stepEl.addEventListener('mouseenter', () => {
          miniCells.forEach(cell => cell.classList.remove('highlighted'));
          const move = record.moves[stepIndex];
          if (move) {
            const cellIndex = move.row * BOARD_SIZE + move.col;
            if (miniCells[cellIndex]) {
              miniCells[cellIndex].classList.add('highlighted');
            }
          }
        });

        stepEl.addEventListener('mouseleave', () => {
          miniCells.forEach(cell => cell.classList.remove('highlighted'));
        });
      });

      this.historyList.appendChild(item);
    });
  }

  private createMiniBoard(moves: Move[]): HTMLElement {
    const miniBoard = document.createElement('div');
    miniBoard.className = 'mini-board';

    const boardState: (Player | null)[][] = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = document.createElement('div');
        cell.className = 'mini-cell';
        cell.dataset.row = row.toString();
        cell.dataset.col = col.toString();
        miniBoard.appendChild(cell);
      }
    }

    moves.forEach((move, index) => {
      boardState[move.row][move.col] = move.player;
      const cellIndex = move.row * BOARD_SIZE + move.col;
      const cell = miniBoard.children[cellIndex] as HTMLElement;

      const piece = document.createElement('div');
      piece.className = `mini-piece ${move.player}`;

      const stepNum = document.createElement('div');
      stepNum.className = 'step-number';
      stepNum.textContent = (index + 1).toString();

      cell.appendChild(piece);
      cell.appendChild(stepNum);
    });

    return miniBoard;
  }
}
