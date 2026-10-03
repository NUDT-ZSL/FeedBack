import { FishManager } from './FishManager';
import { SceneManager } from './SceneManager';
import { UIController } from './UIController';
import { Simulation } from './sim/Simulation';
import { serializeTrajectory } from './sim/trajectory';

class Game {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sim!: Simulation;
  private fishManager!: FishManager;
  private sceneManager!: SceneManager;
  private uiController!: UIController;
  private lastTime = 0;
  private rafId = 0;
  private container!: HTMLElement;
  private seed = 0;

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

    // 支持 ?seed= 复现同一次运行；默认随机种子并打印，便于事后导出/回放
    const seedParam = new URLSearchParams(window.location.search).get('seed');
    this.seed = seedParam !== null && /^\d+$/.test(seedParam)
      ? Number(seedParam) >>> 0
      : (Math.random() * 0xffffffff) >>> 0;

    this.sim = new Simulation({
      seed: this.seed,
      width: this.canvas.width,
      height: this.canvas.height,
      initialFish: 10
    }, { record: true });
    this.fishManager = this.sim.fishManager;
    this.sceneManager = new SceneManager(this.ctx, this.canvas.width, this.canvas.height, this.sim.decorationManager);

    this.uiController = new UIController(this.container, this.canvas, this.fishManager, this.sceneManager);
    // 交互只产生"输入事件"，由模拟在固定时间步统一应用（与离线回放走同一条链路）
    this.uiController.setFoodClickHandler((x, y) => {
      this.sim.queueInput({ type: 'addFood', x, y });
      this.sceneManager.spawnParticles(x, y, '#ffab91', 8);
    });
    this.uiController.setDecorationPlaceHandler((type, x, y) => {
      this.sim.queueInput({ type: 'addDecoration', decoration: type, x, y });
    });
    this.uiController.setTrajectoryExportHandler(() => {
      this.exportTrajectory();
    });

    console.info(`[像素鱼缸] 本次运行 seed=${this.seed}，可通过 ?seed=${this.seed} 复现`);

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

  private exportTrajectory(): void {
    const blob = new Blob([serializeTrajectory(this.sim.getTrajectory())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixel-fish-tank-trajectory-${this.seed}-${this.sim.currentStep}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

    // 固定时间步推进模拟，真实帧率只影响渲染节奏，不影响生态演变
    this.sim.advance(dt);
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
