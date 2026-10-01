import GUI from 'lil-gui';
import { EnvironmentManager } from './environment';
import { CoralManager } from './coral';
import { FishManager } from './fish';

export interface GUICallbacks {
  onReset: () => void;
  onToggleSchool: () => void;
}

export class GUIManager {
  public gui: GUI;
  public environment: EnvironmentManager;
  public coralManager: CoralManager;
  public fishManager: FishManager;
  public callbacks: GUICallbacks;
  public params: {
    temperature: number;
    lightIntensity: number;
    turbidity: number;
  };

  constructor(
    container: HTMLElement,
    environment: EnvironmentManager,
    coralManager: CoralManager,
    fishManager: FishManager,
    callbacks: GUICallbacks
  ) {
    this.environment = environment;
    this.coralManager = coralManager;
    this.fishManager = fishManager;
    this.callbacks = callbacks;
    this.params = {
      temperature: 25,
      lightIntensity: 80,
      turbidity: 10,
    };

    this.gui = new GUI({
      container: container,
      title: '🌊 水质参数控制',
    });

    this.setupControls();
    this.setupMobileMenu();
  }

  private setupControls(): void {
    const waterFolder = this.gui.addFolder('💧 水质参数');
    waterFolder.open();

    const tempCtrl = waterFolder
      .add(this.params, 'temperature', 15, 35, 0.5)
      .name('🌡️ 水温 (°C)')
      .onChange((value: number) => {
        this.environment.setTemperature(value);
        this.updateHUDField('water-temp', value.toFixed(1));
      });

    const lightCtrl = waterFolder
      .add(this.params, 'lightIntensity', 0, 100, 1)
      .name('☀️ 光照强度')
      .onChange((value: number) => {
        this.environment.setLightIntensity(value);
      });

    const turbidityCtrl = waterFolder
      .add(this.params, 'turbidity', 0, 100, 1)
      .name('💦 浑浊度')
      .onChange((value: number) => {
        this.environment.setTurbidity(value);
      });

    const actionFolder = this.gui.addFolder('⚙️ 操作');
    actionFolder.open();

    actionFolder
      .add({ toggle: () => this.callbacks.onToggleSchool() }, 'toggle')
      .name('🐟 切换鱼群数量');

    actionFolder
      .add({ reset: () => this.callbacks.onReset() }, 'reset')
      .name('🔄 重置环境');
  }

  private setupMobileMenu(): void {
    const menuToggle = document.getElementById('menu-toggle');
    const guiContainer = document.getElementById('gui-container');
    if (!menuToggle || !guiContainer) return;

    let isOpen = false;
    menuToggle.addEventListener('click', () => {
      isOpen = !isOpen;
      if (isOpen) {
        guiContainer.classList.add('open');
        guiContainer.classList.remove('collapsed');
      } else {
        guiContainer.classList.remove('open');
        guiContainer.classList.add('collapsed');
      }
    });
  }

  public updateHUDField(id: string, value: string): void {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  public reset(): void {
    this.params.temperature = 25;
    this.params.lightIntensity = 80;
    this.params.turbidity = 10;
    this.environment.setTemperature(25);
    this.environment.setLightIntensity(80);
    this.environment.setTurbidity(10);
    this.updateHUDField('water-temp', '25.0');
    this.gui.controllersRecursive().forEach(c => c.updateDisplay());
  }
}
