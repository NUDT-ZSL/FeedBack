/**
 * 纯生长推演核心：不依赖 three.js / DOM，可在 Node 中离线复算。
 *
 * 渲染层（plant.ts）与离线验证（test/）共用同一份状态推进逻辑，
 * 保证界面展示的阶段、萎蔫程度与开花倒计时和批量复算结果口径一致。
 */

export interface PlantParams {
  light: number;
  water: number;
  temperature: number;
}

export type GrowthStage = 'seed' | 'sprout' | 'adult' | 'flowering';

/** 萎蔫判定阈值（与界面行为一致）。 */
export const WILT_LIMITS = {
  lightMin: 15,
  lightMax: 90,
  waterMin: 15,
  waterMax: 90,
  tempMin: 5,
  tempMax: 35
};

/** 各阶段累计生长时间边界（秒）：seed < 5 <= sprout < 15 <= adult < 30 <= flowering。 */
export const STAGE_BOUNDARIES = {
  sprout: 5,
  adult: 15,
  flowering: 30
};

export const DEFAULT_PARAMS: PlantParams = { light: 50, water: 50, temperature: 20 };

export interface SimulationSnapshot {
  growthTime: number;
  stage: GrowthStage;
  isWilting: boolean;
  wiltProgress: number;
  growthRate: number;
  countdownSeconds: number;
  growthDays: number;
}

export class PlantSimulation {
  public params: PlantParams;
  public growthTime: number = 0;
  public currentStage: GrowthStage = 'seed';
  public isWilting: boolean = false;
  public wiltProgress: number = 0;

  constructor(params: PlantParams = { ...DEFAULT_PARAMS }) {
    this.params = { ...params };
  }

  /** 当前参数下的生长速率。 */
  public getGrowthRate(): number {
    const { light, water } = this.params;
    const lightFactor = Math.sin((light / 100) * Math.PI);
    const waterFactor = Math.sin((water / 100) * Math.PI);
    const tempFactor = this.params.temperature >= 10 && this.params.temperature <= 32 ? 1 : 0.3;
    return 0.3 + 0.7 * lightFactor * waterFactor * tempFactor;
  }

  /** 按累计生长时间判定阶段。 */
  public getStage(): GrowthStage {
    if (this.growthTime < STAGE_BOUNDARIES.sprout) return 'seed';
    if (this.growthTime < STAGE_BOUNDARIES.adult) return 'sprout';
    if (this.growthTime < STAGE_BOUNDARIES.flowering) return 'adult';
    return 'flowering';
  }

  public getGrowthDays(): number {
    return Math.floor(this.growthTime * 1.5);
  }

  /**
   * 距开花的剩余秒数（倒计时原始值，展示层做 ceil 与文案）。
   * 已开花时为 0。
   */
  public getFloweringCountdown(): number {
    const remaining = Math.max(0, STAGE_BOUNDARIES.flowering - this.growthTime);
    return remaining / Math.max(0.1, this.getGrowthRate());
  }

  public snapshot(): SimulationSnapshot {
    return {
      growthTime: this.growthTime,
      stage: this.currentStage,
      isWilting: this.isWilting,
      wiltProgress: this.wiltProgress,
      growthRate: this.getGrowthRate(),
      countdownSeconds: this.getFloweringCountdown(),
      growthDays: this.getGrowthDays()
    };
  }

  /** 参数变化时重新判定萎蔫（与原渲染循环 updateParams 触发时机一致）。 */
  public updateParams(params: PlantParams) {
    this.params = { ...params };
    this.checkWilting();
  }

  public reset() {
    this.growthTime = 0;
    this.currentStage = 'seed';
    this.isWilting = false;
    this.wiltProgress = 0;
    this.params = { ...DEFAULT_PARAMS };
  }

  /** 推进一帧（delta 单位：秒）。 */
  public update(delta: number) {
    if (!this.isWilting || this.wiltProgress < 0.9) {
      this.growthTime += delta * this.getGrowthRate();
    }
    this.updateStage();

    const targetWilt = this.isWilting ? 1 : 0;
    this.wiltProgress += (targetWilt - this.wiltProgress) * delta * 2;
  }

  private checkWilting() {
    const { light, water, temperature } = this.params;
    const badConditions =
      light < WILT_LIMITS.lightMin || light > WILT_LIMITS.lightMax ||
      water < WILT_LIMITS.waterMin || water > WILT_LIMITS.waterMax ||
      temperature < WILT_LIMITS.tempMin || temperature > WILT_LIMITS.tempMax;

    if (badConditions && !this.isWilting) {
      this.isWilting = true;
    } else if (!badConditions && this.isWilting) {
      this.isWilting = false;
    }
  }

  private updateStage() {
    const newStage = this.getStage();
    if (newStage !== this.currentStage) {
      this.currentStage = newStage;
    }
  }
}
