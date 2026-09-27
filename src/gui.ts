import GUI from 'lil-gui';
import { PlantParams } from './plant';

export interface GUICallbacks {
  onParamsChange: (params: PlantParams) => void;
  onReset: () => void;
}

export class PlantGUI {
  private gui: GUI;
  private params: PlantParams;
  private callbacks: GUICallbacks;

  constructor(callbacks: GUICallbacks) {
    this.callbacks = callbacks;
    this.params = {
      light: 50,
      water: 50,
      temperature: 20
    };

    this.gui = new GUI({ title: '🌿 环境控制' });
    this.setupControls();
  }

  private setupControls() {
    const lightFolder = this.gui.addFolder('☀️ 光照');
    lightFolder.add(this.params, 'light', 0, 100, 1)
      .name('光照强度 (%)')
      .onChange(() => this.callbacks.onParamsChange({ ...this.params }));

    const waterFolder = this.gui.addFolder('💧 水分');
    waterFolder.add(this.params, 'water', 0, 100, 1)
      .name('水分供给 (%)')
      .onChange(() => this.callbacks.onParamsChange({ ...this.params }));

    const tempFolder = this.gui.addFolder('🌡️ 温度');
    tempFolder.add(this.params, 'temperature', 0, 40, 0.5)
      .name('环境温度 (°C)')
      .onChange(() => this.callbacks.onParamsChange({ ...this.params }));

    lightFolder.open();
    waterFolder.open();
    tempFolder.open();
  }

  public getParams(): PlantParams {
    return { ...this.params };
  }

  public reset() {
    this.params.light = 50;
    this.params.water = 50;
    this.params.temperature = 20;
    this.gui.controllersRecursive().forEach(c => c.updateDisplay());
  }

  public dispose() {
    this.gui.destroy();
  }
}
