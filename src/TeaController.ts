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
type WarningChangeCallback = (paramKey: string, active: boolean) => void;

const PARAM_KEYS = ['waterTemp', 'pourAngle', 'brewDuration'] as const;
type ParamKey = (typeof PARAM_KEYS)[number];

export class TeaController {
  private params: TeaParams;
  private currentPreset: TeaPreset | null = null;
  private presets: TeaPreset[] = TEA_PRESETS;
  private paramsChangeCallbacks: ParamsChangeCallback[] = [];
  private presetChangeCallbacks: PresetChangeCallback[] = [];
  private warningChangeCallbacks: WarningChangeCallback[] = [];
  private warningTimers: Map<string, number> = new Map();
  private warningActive: Map<string, boolean> = new Map();
  private disposed: boolean = false;

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
      this.clearAllWarnings();
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

  private checkParamWarning(paramKey: ParamKey): void {
    if (!this.currentPreset) return;

    const validation = this.validateParams();
    const isValid = paramKey === 'waterTemp' ? validation.temp :
                    paramKey === 'pourAngle' ? validation.angle :
                    validation.duration;

    if (!isValid) {
      this.triggerWarning(paramKey);
    } else {
      this.stopWarning(paramKey);
    }
  }

  private triggerWarning(paramKey: string): void {
    if (this.disposed) return;

    const existingTimer = this.warningTimers.get(paramKey);
    if (existingTimer !== undefined) {
      clearInterval(existingTimer);
      this.warningTimers.delete(paramKey);
    }

    this.setWarningState(paramKey, true);

    const element = this.queryParamElement(paramKey);
    let flashCount = 0;
    const maxFlashes = 6;
    const flashInterval = setInterval(() => {
      if (flashCount >= maxFlashes) {
        clearInterval(flashInterval);
        if (this.warningTimers.get(paramKey) === flashInterval) {
          this.warningTimers.delete(paramKey);
          this.setWarningState(paramKey, false);
        }
        return;
      }
      if (element) {
        element.classList.toggle('warning-flash');
      }
      flashCount++;
    }, 500);
    this.warningTimers.set(paramKey, flashInterval as unknown as number);
  }

  private stopWarning(paramKey: string): void {
    const timer = this.warningTimers.get(paramKey);
    if (timer !== undefined) {
      clearInterval(timer);
      this.warningTimers.delete(paramKey);
    }
    if (this.warningActive.get(paramKey)) {
      this.setWarningState(paramKey, false);
    }
    this.queryParamElement(paramKey)?.classList.remove('warning-flash');
  }

  private clearAllWarnings(): void {
    PARAM_KEYS.forEach(key => this.stopWarning(key));
  }

  private queryParamElement(paramKey: string): Element | null {
    if (typeof document === 'undefined') return null;
    return document.querySelector(`[data-param="${paramKey}"]`);
  }

  private setWarningState(paramKey: string, active: boolean): void {
    this.warningActive.set(paramKey, active);
    this.warningChangeCallbacks.forEach(cb => cb(paramKey, active));
  }

  isWarningActive(paramKey: string): boolean {
    return this.warningActive.get(paramKey) === true;
  }

  getActiveWarnings(): string[] {
    return PARAM_KEYS.filter(key => this.isWarningActive(key));
  }

  onWarningChange(callback: WarningChangeCallback): void {
    this.warningChangeCallbacks.push(callback);
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
    this.clearAllWarnings();
    this.notifyParamsChange();
    this.notifyPresetChange();
  }

  dispose(): void {
    this.disposed = true;
    this.clearAllWarnings();
    this.currentPreset = null;
    this.paramsChangeCallbacks = [];
    this.presetChangeCallbacks = [];
    this.warningChangeCallbacks = [];
  }
}
