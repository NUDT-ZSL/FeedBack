import { ForgeCore } from './forgeCore';
import { SceneManager } from './sceneManager';
import { UIController } from './uiController';

class App {
  private forgeCore: ForgeCore;
  private sceneManager: SceneManager;
  private uiController: UIController;
  private animationId: number = 0;
  private lastTime: number = 0;
  private frameCount: number = 0;
  private fpsUpdateTime: number = 0;

  constructor() {
    this.forgeCore = new ForgeCore();
    this.sceneManager = new SceneManager('canvas-container');
    this.uiController = new UIController(
      this.forgeCore,
      this.sceneManager,
      this.sceneManager.getParticleSystem()
    );
    
    this.lastTime = performance.now();
    this.animate();
    
    window.addEventListener('beforeunload', () => this.dispose());
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());
    
    const currentTime = performance.now();
    const delta = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;
    
    this.forgeCore.update(delta);
    this.sceneManager.render();
    
    this.frameCount++;
    if (currentTime - this.fpsUpdateTime > 1000) {
      const fps = this.frameCount * 1000 / (currentTime - this.fpsUpdateTime);
      if (fps < 45) {
        console.warn(`Performance warning: FPS dropped to ${fps.toFixed(1)}`);
      }
      this.frameCount = 0;
      this.fpsUpdateTime = currentTime;
    }
  }

  private dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.sceneManager.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
