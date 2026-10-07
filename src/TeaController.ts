export interface TeaParams {
  waterTemp: number;
  pourAngle: number;
  brewDuration: number;
}

export interface TeaPreset {
  name: string;
  origin: string;
  recommendedTemp: [number, number];
  recommendedAngle: [number, number];
  recommendedDuration: [number, number];
}

export const TEA_PRESETS: TeaPreset[] = [
  {
    name: '龙井',
    origin: '浙江杭州',
    recommendedTemp: [75, 85],
    recommendedAngle: [30, 45],
    recommendedDuration: [10, 20]
  },
  {
    name: '铁观音',
    origin: '福建安溪',
    recommendedTemp: [90, 95],
    recommendedAngle: [45, 60],
    recommendedDuration: [30, 45]
  },
  {
    name: '普洱',
    origin: '云南',
    recommendedTemp: [95, 100],
    recommendedAngle: [60, 75],
    recommendedDuration: [60, 120]
  },
  {
    name: '正山小种',
    origin: '福建武夷山',
    recommendedTemp: [85, 90],
    recommendedAngle: [45, 60],
    recommendedDuration: [20, 30]
  }
];

type ParamsChangeCallback = (params: TeaParams) => void;
type PresetChangeCallback = (preset: TeaPreset | null) => void;

export class TeaController {
  private params: TeaParams;
  private currentPreset: TeaPreset | null = null;
  private presets: TeaPreset[] = TEA_PRESETS;
  private paramsChangeCallbacks: ParamsChangeCallback[] = [];
  private presetChangeCallbacks: PresetChangeCallback[] = [];
  private warningTimers: Map<string, number> = new Map();

  constructor() {
    this.params = {
      waterTemp: 85,
      pourAngle: 45,
      brewDuration: 30
    };
  }

  getParams(): TeaParams {
    return { ...this.params };
  }

  getPresets(): TeaPreset[] {
    return [...this.presets];
  }

  getCurrentPreset(): TeaPreset | null {
    return this.currentPreset;
  }

  setWaterTemp(value: number): void {
    this.params.waterTemp = Math.max(0, Math.min(100, value));
    this.notifyParamsChange();
    this.checkParamWarning('waterTemp');
  }

  setPourAngle(value: number): void {
    this.params.pourAngle = Math.max(0, Math.min(90, value));
    this.notifyParamsChange();
    this.checkParamWarning('pourAngle');
  }

  setBrewDuration(value: number): void {
    this.params.brewDuration = Math.max(0, Math.min(180, value));
    this.notifyParamsChange();
    this.checkParamWarning('brewDuration');
  }

  loadPreset(presetName: string): void {
    const preset = this.presets.find(p => p.name === presetName);
    if (preset) {
      this.currentPreset = preset;
      this.setWaterTemp(
        (preset.recommendedTemp[0] + preset.recommendedTemp[1]) / 2
      );
      this.setPourAngle(
        (preset.recommendedAngle[0] + preset.recommendedAngle[1]) / 2
      );
      this.setBrewDuration(
        (preset.recommendedDuration[0] + preset.recommendedDuration[1]) / 2
      );
      this.notifyPresetChange();
    }
  }

  validateParams(): { temp: boolean; angle: boolean; duration: boolean } {
    if (!this.currentPreset) {
      return { temp: true, angle: true, duration: true };
    }

    const { waterTemp, pourAngle, brewDuration } = this.params;
    const { recommendedTemp, recommendedAngle, recommendedDuration } = this.currentPreset;

    return {
      temp: waterTemp >= recommendedTemp[0] && waterTemp <= recommendedTemp[1],
      angle: pourAngle >= recommendedAngle[0] && pourAngle <= recommendedAngle[1],
      duration: brewDuration >= recommendedDuration[0] && brewDuration <= recommendedDuration[1]
    };
  }

  private checkParamWarning(paramKey: 'waterTemp' | 'pourAngle' | 'brewDuration'): void {
    if (!this.currentPreset) return;

    const validation = this.validateParams();
    const isValid = paramKey === 'waterTemp' ? validation.temp :
                    paramKey === 'pourAngle' ? validation.angle :
                    validation.duration;

    if (!isValid) {
      this.triggerWarning(paramKey);
    }
  }

  private triggerWarning(paramKey: string): void {
    const existingTimer = this.warningTimers.get(paramKey);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    const element = document.querySelector(`[data-param="${paramKey}"]`);
    if (element) {
      let flashCount = 0;
      const maxFlashes = 6;
      const flashInterval = window.setInterval(() => {
        if (flashCount >= maxFlashes) {
          window.clearInterval(flashInterval);
          this.warningTimers.delete(paramKey);
          return;
        }
        element.classList.toggle('warning-flash');
        flashCount++;
      }, 500);
      this.warningTimers.set(paramKey, flashInterval as unknown as number);
    }
  }

  onParamsChange(callback: ParamsChangeCallback): void {
    this.paramsChangeCallbacks.push(callback);
  }

  onPresetChange(callback: PresetChangeCallback): void {
    this.presetChangeCallbacks.push(callback);
  }

  private notifyParamsChange(): void {
    this.paramsChangeCallbacks.forEach(cb => cb(this.getParams()));
  }

  private notifyPresetChange(): void {
    this.presetChangeCallbacks.forEach(cb => cb(this.currentPreset));
  }

  reset(): void {
    this.params = {
      waterTemp: 85,
      pourAngle: 45,
      brewDuration: 30
    };
    this.currentPreset = null;
    this.warningTimers.forEach(timer => window.clearTimeout(timer));
    this.warningTimers.clear();
    this.notifyParamsChange();
    this.notifyPresetChange();
  }

  dispose(): void {
    this.paramsChangeCallbacks = [];
    this.presetChangeCallbacks = [];
    this.warningTimers.forEach(timer => window.clearTimeout(timer));
    this.warningTimers.clear();
  }
}
