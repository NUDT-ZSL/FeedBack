import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

interface Client {
  ws: WebSocket;
  player: 'red' | 'blue' | null;
  isReady: boolean;
}

const clients: Client[] = [];
let gameState: {
  board: (string | null)[][];
  currentPlayer: 'red' | 'blue';
  gameOver: boolean;
} = {
  board: Array(5).fill(null).map(() => Array(5).fill(null)),
  currentPlayer: 'red',
  gameOver: false
};

app.use(express.static(path.join(__dirname, '..', '..')));

function resetGameState(): void {
  gameState = {
    board: Array(5).fill(null).map(() => Array(5).fill(null)),
    currentPlayer: 'red',
    gameOver: false
  };
}

function broadcast(message: unknown, excludeWs?: WebSocket): void {
  const msg = JSON.stringify(message);
  clients.forEach(client => {
    if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  });
}

function assignPlayer(client: Client): void {
  const hasRed = clients.some(c => c.player === 'red');
  const hasBlue = clients.some(c => c.player === 'blue');

  if (!hasRed) {
    client.player = 'red';
  } else if (!hasBlue) {
    client.player = 'blue';
  } else {
    client.player = null;
  }
}

wss.on('connection', (ws) => {
  const client: Client = {
    ws,
    player: null,
    isReady: false
  };

  clients.push(client);
  assignPlayer(client);

  console.log(`Client connected. Assigned: ${client.player}`);
  console.log(`Total clients: ${clients.length}`);

  ws.send(JSON.stringify({
    type: 'connected',
    player: client.player,
    gameState
  }));

  broadcast({
    type: 'playerJoined',
    playerCount: clients.filter(c => c.player !== null).length,
    players: clients.filter(c => c.player !== null).map(c => c.player)
  }, ws);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'move': {
          if (gameState.gameOver) return;
          if (client.player !== gameState.currentPlayer) return;

          const { row, col } = message;
          if (gameState.board[row][col] !== null) return;

          gameState.board[row][col] = client.player;

          broadcast({
            type: 'move',
            row,
            col,
            player: client.player
          });

          const winResult = checkWin(row, col, client.player);
          if (winResult) {
            gameState.gameOver = true;
            broadcast({
              type: 'victory',
              winner: client.player,
              winningLine: winResult
            });
          } else if (isBoardFull()) {
            gameState.gameOver = true;
            broadcast({
              type: 'victory',
              winner: 'draw',
              winningLine: null
            });
          } else {
            gameState.currentPlayer = gameState.currentPlayer === 'red' ? 'blue' : 'red';
            broadcast({
              type: 'turnChange',
              currentPlayer: gameState.currentPlayer
            });
          }
          break;
        }

        case 'reset': {
          resetGameState();
          broadcast({
            type: 'reset',
            gameState
          });
          break;
        }

        case 'ready': {
          client.isReady = true;
          if (clients.filter(c => c.isReady).length >= 2) {
            resetGameState();
            broadcast({
              type: 'gameStart',
              gameState
            });
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    const index = clients.findIndex(c => c.ws === ws);
    if (index !== -1) {
      const leavingPlayer = clients[index].player;
      clients.splice(index, 1);

      console.log(`Client disconnected: ${leavingPlayer}`);

      if (leavingPlayer) {
        clients.forEach(c => {
          if (c.player === null) {
            assignPlayer(c);
            c.ws.send(JSON.stringify({
              type: 'playerAssigned',
              player: c.player
            }));
          }
        });

        broadcast({
          type: 'playerLeft',
          player: leavingPlayer,
          playerCount: clients.filter(c => c.player !== null).length
        });
      }
    }
  });
});

function checkWin(row: number, col: number, player: string): [number, number][] | null {
  const directions: [number, number][] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (const [dr, dc] of directions) {
    const line: [number, number][] = [[row, col]];

    for (let i = 1; i < 5; i++) {
      const newRow = row + dr * i;
      const newCol = col + dc * i;
      if (isValidCell(newRow, newCol) && gameState.board[newRow][newCol] === player) {
        line.push([newRow, newCol]);
      } else {
        break;
      }
    }

    for (let i = 1; i < 5; i++) {
      const newRow = row - dr * i;
      const newCol = col - dc * i;
      if (isValidCell(newRow, newCol) && gameState.board[newRow][newCol] === player) {
        line.push([newRow, newCol]);
      } else {
        break;
      }
    }

    if (line.length >= 5) {
      return line;
    }
  }

  return null;
}

function isValidCell(row: number, col: number): boolean {
  return row >= 0 && row < 5 && col >= 0 && col < 5;
}

function isBoardFull(): boolean {
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (gameState.board[row][col] === null) return false;
    }
  }
  return true;
}

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
  console.log(`HTTP server running on http://localhost:${PORT}`);
});
