import { Ecosystem } from './ecosystem';
import { Renderer } from './renderer';
import { UIManager } from './ui';

let ecosystem: Ecosystem | null = null;
let renderer: Renderer | null = null;
let uiManager: UIManager | null = null;
let animationId: number | null = null;
let lastTime = 0;
let uiUpdateCounter = 0;

function initSimulation(initialCount: number): void {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('Canvas element not found');

  ecosystem = new Ecosystem(initialCount);
  renderer = new Renderer(canvas, ecosystem);
  uiManager = new UIManager(document.body, ecosystem);

  const initialConfig = document.getElementById('initialConfig');
  if (initialConfig) {
    initialConfig.style.display = 'none';
  }

  lastTime = performance.now();
  uiUpdateCounter = 0;

  if (animationId) {
    cancelAnimationFrame(animationId);
  }

  requestAnimationFrame(gameLoop);
}

function gameLoop(currentTime: number): void {
  const deltaTime = (currentTime - lastTime) / 1000;
  lastTime = currentTime;

  if (ecosystem && renderer) {
    ecosystem.update(deltaTime);
    renderer.render();

    uiUpdateCounter++;
    if (uiUpdateCounter >= 6 && uiManager) {
      uiUpdateCounter = 0;
      uiManager.updatePopulation();
    }
  }

  animationId = requestAnimationFrame(gameLoop);
}

function handleResize(): void {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas || !renderer) return;

  const container = canvas.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const size = Math.min(rect.width - 40, rect.height - 40, 800);

  canvas.width = size;
  canvas.height = size;
  renderer.resize(size, size);
}

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const countInput = document.getElementById('animalCount') as HTMLInputElement;

  startBtn?.addEventListener('click', () => {
    let count = parseInt(countInput.value, 10);
    count = Math.max(50, Math.min(200, count));
    initSimulation(count);
  });

  window.addEventListener('resize', handleResize);

  handleResize();
});
