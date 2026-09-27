import { Game } from './game';
import { Renderer } from './renderer';
import { GameState } from './types';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const game = new Game();
const renderer = new Renderer(ctx, canvas.width, canvas.height);
renderer.resize(canvas.width, canvas.height, game.maze.size);

let lastTime = performance.now();

function resizeCanvas(): void {
  const container = document.getElementById('game-container')!;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  
  const size = Math.min(containerWidth, containerHeight) * 0.9;
  const finalSize = Math.max(500, Math.min(size, 800));
  
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = finalSize * dpr;
  canvas.height = finalSize * dpr;
  canvas.style.width = `${finalSize}px`;
  canvas.style.height = `${finalSize}px`;
  
  ctx.scale(dpr, dpr);
  
  renderer.resize(finalSize, finalSize, game.maze.size);
}

function gameLoop(currentTime: number): void {
  const deltaTime = Math.min(currentTime - lastTime, 100);
  lastTime = currentTime;
  
  renderer.updateFPS(deltaTime);
  
  game.update(deltaTime, currentTime);
  
  renderer.clear();
  
  switch (game.state) {
    case GameState.MENU:
      renderer.drawMenu(game.getHighScore());
      break;
      
    case GameState.PLAYING:
      renderer.drawBackgroundGlow();
      renderer.drawMazeBorder();
      renderer.drawMaze(game.maze, game.reconstructState, currentTime);
      renderer.drawTreasures(game.maze, currentTime);
      renderer.drawTraps(game.maze, currentTime);
      renderer.drawTrail(game.player, currentTime);
      renderer.drawPlayer(game.player, currentTime);
      renderer.drawHUD(
        game.survivalTime,
        game.treasuresCollected,
        game.totalTreasures,
        game.player.trapHits,
        game.player.maxTrapHits
      );
      renderer.drawScreenFlash(currentTime, game.screenFlashEndTime);
      break;
      
    case GameState.GAMEOVER:
      renderer.drawBackgroundGlow();
      renderer.drawMazeBorder();
      renderer.drawMaze(game.maze, null, currentTime);
      renderer.drawTreasures(game.maze, currentTime);
      renderer.drawTraps(game.maze, currentTime);
      renderer.drawPlayer(game.player, currentTime);
      renderer.drawFadeOut(currentTime, game.fadeOutStartTime);
      
      if (game.status) {
        renderer.drawGameOver(
          game.status,
          game.getScore(),
          game.survivalTime,
          game.treasuresCollected
        );
      }
      break;
  }
  
  requestAnimationFrame(gameLoop);
}

function handleKeyDown(e: KeyboardEvent): void {
  const currentTime = performance.now();
  game.handleKeyDown(e.key, currentTime);
}

function handleClick(e: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const currentTime = performance.now();
  
  game.handleClick(x, y, renderer.width, renderer.height, currentTime);
}

function handleResize(): void {
  resizeCanvas();
}

resizeCanvas();
window.addEventListener('resize', handleResize);
window.addEventListener('keydown', handleKeyDown);
canvas.addEventListener('click', handleClick);

requestAnimationFrame(gameLoop);
