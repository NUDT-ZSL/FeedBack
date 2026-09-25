import { SceneManager } from './sceneManager';
import { UIController } from './uiController';

class App {
  private sceneManager: SceneManager;
  private uiController: UIController;
  private clock: { getDelta: () => number; getElapsedTime: () => number };
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsEl: HTMLElement;

  constructor() {
    const container = document.getElementById('canvas-container')!;
    this.sceneManager = new SceneManager(container);
    this.uiController = new UIController(this.sceneManager);
    this.clock = {
      getDelta: () => {
        const now = performance.now() / 1000;
        const d = now - (this as any)._lastTime;
        (this as any)._lastTime = now;
        return Math.min(d, 0.1);
      },
      getElapsedTime: () => performance.now() / 1000,
    };
    (this as any)._lastTime = performance.now() / 1000;

    this.fpsEl = document.getElementById('fps-counter')!;

    this.uiController.initialize(0);
    this.animate();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();

    this.sceneManager.update(delta);

    this.fpsFrames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 1) {
      this.fpsEl.textContent = Math.round(this.fpsFrames / this.fpsTime) + ' FPS';
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  };
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
