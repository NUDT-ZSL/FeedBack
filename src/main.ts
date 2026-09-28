import { sceneManager } from './core/SceneManager';
import { buildingSystem } from './modules/building/BuildingSystem';
import { trafficSystem } from './modules/traffic/TrafficSystem';
import { lightingController } from './modules/lighting/LightingController';
import { controlPanel } from './ui/ControlPanel';

class Application {
  private _initialized: boolean = false;

  constructor() {}

  public init(): void {
    if (this._initialized) return;

    const appContainer = document.getElementById('app');
    if (!appContainer) {
      console.error('App container not found');
      return;
    }

    appContainer.appendChild(sceneManager.domElement);

    trafficSystem.init();
    trafficSystem.start();

    lightingController.setAllLightsImmediate('day');

    void controlPanel;

    sceneManager.startAnimation();

    this._hideLoading();

    this._initialized = true;

    console.log('城市天际线沙盘推演系统已启动');
    console.log('操作说明:');
    console.log('  - 鼠标左键点击地面: 放置建筑');
    console.log('  - 鼠标左键点击建筑: 选中并编辑');
    console.log('  - 鼠标右键拖动: 旋转视角');
    console.log('  - 鼠标滚轮: 缩放视角');
    console.log('  - 鼠标中键拖动: 平移视角');
  }

  private _hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) {
      setTimeout(() => {
        loading.classList.add('hidden');
        setTimeout(() => {
          loading.remove();
        }, 500);
      }, 300);
    }
  }

  public destroy(): void {
    sceneManager.dispose();
    trafficSystem.dispose();
    controlPanel.dispose();
    this._initialized = false;
  }
}

const app = new Application();

window.addEventListener('DOMContentLoaded', () => {
  app.init();
});

export { app };
