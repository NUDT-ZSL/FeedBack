import { FishManager } from './FishManager';
import { SceneManager, type DecorationType } from './SceneManager';
import { UIController } from './UIController';

class Game {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private fishManager!: FishManager;
  private sceneManager!: SceneManager;
  private uiController!: UIController;
  private lastTime = 0;
  private rafId = 0;
  private container!: HTMLElement;

  start(): void {
    this.container = document.getElementById('app')!;

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.insertBefore(this.canvas, this.container.firstChild);

    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.fishManager = new FishManager(this.canvas.width, this.canvas.height);
    this.sceneManager = new SceneManager(this.ctx, this.canvas.width, this.canvas.height);
    this.fishManager.initialize();

    this.uiController = new UIController(this.container, this.canvas, this.fishManager, this.sceneManager);
    this.uiController.setFoodClickHandler((x, y) => {
      this.fishManager.addFood(x, y);
      this.sceneManager.spawnParticles(x, y, '#ffab91', 8);
    });
    this.uiController.setDecorationPlaceHandler((type: DecorationType, x: number, y: number) => {
      this.sceneManager.addDecoration(type, x, y);
    });

    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) loading.classList.add('hidden');
    }, 600);

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);

    window.addEventListener('beforeunload', () => {
      if (this.rafId) cancelAnimationFrame(this.rafId);
    });
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.fishManager) this.fishManager.resize(w, h);
    if (this.sceneManager) this.sceneManager.resize(w, h);
  }

  private loop = (time: number): void => {
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;

    this.fishManager.update(dt);
    this.sceneManager.render(dt, this.fishManager);
    this.uiController.update(dt);

    this.rafId = requestAnimationFrame(this.loop);
  };
}

const game = new Game();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => game.start());
} else {
  game.start();
}
