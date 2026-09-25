import { Pane } from 'tweakpane';
import type { HeightDistribution, ColorTheme, CityParams } from './cityBuilder';

export interface ControlPanelConfig {
  density: number;
  heightDistribution: HeightDistribution;
  colorTheme: ColorTheme;
  buildingSpacing: number;
}

export interface ControlPanelCallbacks {
  onParamsChange: (params: Partial<CityParams>) => void;
  onGenerate: () => void;
}

export class ControlPanel {
  private pane: Pane;
  private config: ControlPanelConfig;
  private callbacks: ControlPanelCallbacks;

  constructor(container: HTMLElement, initialConfig: ControlPanelConfig, callbacks: ControlPanelCallbacks) {
    this.config = { ...initialConfig };
    this.callbacks = callbacks;

    this.pane = new Pane({
      title: '城市参数',
      container,
      expanded: true
    });

    const style = document.createElement('style');
    style.textContent = `
      .tp-dfwv {
        position: fixed !important;
        top: 20px !important;
        left: 20px !important;
        width: 280px !important;
        background: rgba(255, 255, 255, 0.1) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        border-radius: 16px !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2) !important;
        z-index: 1000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .tp-dfwv .tp-tv {
        color: rgba(255, 255, 255, 0.9) !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        padding: 12px 16px !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
      }

      .tp-dfwv .tp-lblv {
        color: rgba(255, 255, 255, 0.7) !important;
        font-size: 12px !important;
      }

      .tp-dfwv .tp-sldd {
        background: rgba(255, 255, 255, 0.1) !important;
        border-radius: 4px !important;
      }

      .tp-dfwv .tp-sldd_g {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.5)) !important;
        border-radius: 4px !important;
      }

      .tp-dfwv .tp-sldd_h {
        background: rgba(255, 255, 255, 0.9) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
      }

      .tp-dfwv .tp-txtv {
        background: rgba(255, 255, 255, 0.1) !important;
        color: rgba(255, 255, 255, 0.9) !important;
        border-radius: 4px !important;
        border: none !important;
        padding: 4px 8px !important;
      }

      .tp-dfwv .tp-pulldown {
        background: rgba(255, 255, 255, 0.1) !important;
        border-radius: 4px !important;
        border: none !important;
        color: rgba(255, 255, 255, 0.9) !important;
      }

      .tp-dfwv .tp-btn {
        background: linear-gradient(135deg, rgba(155, 93, 229, 0.8), rgba(247, 37, 133, 0.8)) !important;
        border: none !important;
        border-radius: 8px !important;
        color: white !important;
        font-weight: 600 !important;
        padding: 8px 16px !important;
        transition: transform 0.2s ease, box-shadow 0.2s ease !important;
      }

      .tp-dfwv .tp-btn:hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 4px 12px rgba(155, 93, 229, 0.4) !important;
      }

      .tp-dfwv .tp-btn:active {
        transform: translateY(0) !important;
      }

      .tp-dfwv .tp-rotv {
        background: rgba(255, 255, 255, 0.1) !important;
      }

      .tp-dfwv .tp-rotv_m {
        background: rgba(255, 255, 255, 0.3) !important;
      }

      .tp-dfwv .tp-fld {
        padding: 8px 16px !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
      }

      .tp-dfwv .tp-fld:hover {
        background: rgba(255, 255, 255, 0.05) !important;
      }

      @media (max-width: 1440px) {
        .tp-dfwv {
          width: 240px !important;
          top: 12px !important;
          left: 12px !important;
        }
      }

      @media (min-width: 2560px) {
        .tp-dfwv {
          width: 320px !important;
          top: 24px !important;
          left: 24px !important;
        }
      }
    `;
    document.head.appendChild(style);

    this.setupControls();
  }

  private setupControls(): void {
    this.pane.addBinding(this.config, 'density', {
      label: '建筑密度',
      min: 0.2,
      max: 1.0,
      step: 0.05
    }).on('change', (e) => {
      this.config.density = e.value as number;
      this.callbacks.onParamsChange({ density: e.value as number });
    });

    this.pane.addBinding(this.config, 'heightDistribution', {
      label: '高度分布',
      options: {
        '均匀': 'uniform',
        '金字塔': 'pyramid',
        '随机': 'random'
      }
    }).on('change', (e) => {
      this.config.heightDistribution = e.value as HeightDistribution;
      this.callbacks.onParamsChange({ heightDistribution: e.value as HeightDistribution });
    });

    this.pane.addBinding(this.config, 'colorTheme', {
      label: '颜色主题',
      options: {
        '日暮': 'sunset',
        '赛博朋克': 'cyberpunk',
        '北欧极简': 'nordic'
      }
    }).on('change', (e) => {
      this.config.colorTheme = e.value as ColorTheme;
      this.callbacks.onParamsChange({ colorTheme: e.value as ColorTheme });
    });

    this.pane.addBinding(this.config, 'buildingSpacing', {
      label: '建筑间距',
      min: 1.5,
      max: 4.0,
      step: 0.1
    }).on('change', (e) => {
      this.config.buildingSpacing = e.value as number;
      this.callbacks.onParamsChange({ buildingSpacing: e.value as number });
    });

    this.pane.addButton({
      title: '重新生成城市',
      label: ''
    }).on('click', () => {
      this.callbacks.onGenerate();
    });
  }

  getConfig(): ControlPanelConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ControlPanelConfig>): void {
    Object.assign(this.config, config);
    this.pane.refresh();
  }

  dispose(): void {
    this.pane.dispose();
  }
}
