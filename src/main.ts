import { GameEngine, type Player, type GameRecord } from './gameEngine';
import { UIRenderer } from './uiRenderer';
import { dataManager } from '../data/dataManager';

interface AppState {
  gameMode: 'local' | 'online';
  localPlayer: Player | null;
  isOnlineTurn: boolean;
  ws: WebSocket | null;
  player1Name: string;
  player2Name: string;
}

class GameApp {
  private gameEngine: GameEngine;
  private uiRenderer: UIRenderer;
  private state: AppState;

  constructor() {
    this.gameEngine = new GameEngine();
    this.uiRenderer = new UIRenderer();
    this.state = {
      gameMode: 'local',
      localPlayer: null,
      isOnlineTurn: false,
      ws: null,
      player1Name: '玩家1',
      player2Name: '玩家2'
    };

    this.init();
  }

  private init(): void {
    this.uiRenderer.createBoard(this.handleCellClick.bind(this));
    this.updateUI();
    this.setupEventListeners();
    this.setupWebSocket();
  }

  private setupEventListeners(): void {
    const newGameBtn = document.getElementById('newGameBtn');
    const historyBtn = document.getElementById('historyBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (newGameBtn) {
      newGameBtn.addEventListener('click', () => this.handleNewGame());
    }

    if (historyBtn) {
      historyBtn.addEventListener('click', () => this.handleShowHistory());
    }

    if (closeSidebarBtn) {
      closeSidebarBtn.addEventListener('click', () => this.uiRenderer.closeSidebar());
    }

    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => this.uiRenderer.closeSidebar());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.uiRenderer.closeSidebar();
      }
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.handleNewGame();
      }
      if (e.key === 'h' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.handleShowHistory();
      }
    });
  }

  private setupWebSocket(): void {
    const serverUrl = `ws://${window.location.hostname}:3001`;

    try {
      const ws = new WebSocket(serverUrl);

      ws.onopen = () => {
        console.log('Connected to game server');
        this.state.ws = ws;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleServerMessage(message);
        } catch (e) {
          console.error('Error parsing server message:', e);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from game server');
        this.state.ws = null;
        if (this.state.gameMode === 'online') {
          this.state.gameMode = 'local';
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.state.gameMode = 'local';
      };
    } catch (e) {
      console.log('WebSocket not available, using local mode');
      this.state.gameMode = 'local';
    }
  }

  private handleServerMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case 'connected':
        this.state.localPlayer = message.player as Player | null;
        if (this.state.localPlayer) {
          this.state.gameMode = 'online';
          this.state.isOnlineTurn = this.state.localPlayer === 'red';
        }
        break;

      case 'playerAssigned':
        this.state.localPlayer = message.player as Player | null;
        if (this.state.localPlayer) {
          this.state.gameMode = 'online';
          this.state.isOnlineTurn = this.state.localPlayer === 'red';
        }
        break;

      case 'move': {
        const row = message.row as number;
        const col = message.col as number;

        if (this.gameEngine.isGameOver()) return;

        const result = this.gameEngine.makeMove(row, col);
        if (result) {
          this.updateUI();

          if (result.winner) {
            this.handleGameEnd(result.winner as Player | 'draw', result.winningLine as [number, number][] | null);
          }
        }

        if (this.state.gameMode === 'online') {
          this.state.isOnlineTurn = this.gameEngine.getCurrentPlayer() === this.state.localPlayer;
        }
        break;
      }

      case 'turnChange':
        if (this.state.gameMode === 'online') {
          this.state.isOnlineTurn = (message.currentPlayer as Player) === this.state.localPlayer;
        }
        break;

      case 'victory': {
        const winner = message.winner as Player | 'draw';
        const winningLine = message.winningLine as [number, number][] | null;
        this.handleGameEnd(winner, winningLine);
        break;
      }

      case 'reset':
        this.handleNewGame(false);
        break;

      case 'gameStart':
        this.handleNewGame(false);
        break;
    }
  }

  private handleCellClick(row: number, col: number): void {
    if (this.gameEngine.isGameOver()) return;

    if (this.state.gameMode === 'online') {
      if (!this.state.isOnlineTurn || !this.state.localPlayer) {
        return;
      }

      if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
        this.state.ws.send(JSON.stringify({
          type: 'move',
          row,
          col
        }));
      }
    } else {
      const result = this.gameEngine.makeMove(row, col);
      if (result) {
        this.updateUI();

        if (result.winner) {
          this.handleGameEnd(result.winner as Player | 'draw', result.winningLine as [number, number][] | null);
        }
      }
    }
  }

  private handleNewGame(sendToServer: boolean = true): void {
    if (this.state.gameMode === 'online' && sendToServer && this.state.ws) {
      if (this.state.ws.readyState === WebSocket.OPEN) {
        this.state.ws.send(JSON.stringify({ type: 'reset' }));
      }
    }

    this.gameEngine.reset();
    this.uiRenderer.resetBoard();
    this.uiRenderer.hideVictory();
    this.updateUI();

    if (this.state.gameMode === 'online') {
      this.state.isOnlineTurn = this.state.localPlayer === 'red';
    }
  }

  private handleShowHistory(): void {
    const records = dataManager.getRecords();
    this.uiRenderer.renderHistory(records);
    this.uiRenderer.openSidebar();
  }

  private handleGameEnd(winner: Player | 'draw', winningLine: [number, number][] | null): void {
    this.uiRenderer.showVictory(winner, winningLine);

    const record = this.gameEngine.createGameRecord(
      this.state.player1Name,
      this.state.player2Name
    );

    if (record) {
      dataManager.addRecord(record as GameRecord);
    }
  }

  private updateUI(): void {
    const board = this.gameEngine.getBoard();
    const currentPlayer = this.gameEngine.getCurrentPlayer();
    const stats = this.gameEngine.getStats();

    this.uiRenderer.updateBoard(board);
    this.uiRenderer.updateCurrentPlayer(currentPlayer);
    this.uiRenderer.updatePreviewPiece(currentPlayer);
    this.uiRenderer.updateStats(stats);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
