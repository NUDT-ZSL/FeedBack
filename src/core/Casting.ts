export type CastingStage = 'cooling' | 'cooled' | 'quenched' | 'inspected';

export interface CastingStats {
  hardness: number;
  toughness: number;
  sharpness: number;
}

export type CastingResult =
  | { ok: true; stats?: CastingStats }
  | { ok: false; reason: string };

export function computeGrade(total: number): '上品' | '良品' | '次品' {
  if (total > 240) return '上品';
  if (total > 200) return '良品';
  return '次品';
}

const COOLED_THRESHOLD = 110;
const DECAY_CONSTANT = Math.log(2) / 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export class Casting {
  readonly id: string;
  readonly moldType: string;
  readonly pourTemperature: number;
  private coolingStartTime: number | null;
  private quenchedFlag: boolean;
  private inspectedFlag: boolean;
  private statsCache: CastingStats | null;

  constructor(id: string, moldType: string, pourTemperature: number) {
    this.id = id;
    this.moldType = moldType;
    this.pourTemperature = pourTemperature;
    this.coolingStartTime = null;
    this.quenchedFlag = false;
    this.inspectedFlag = false;
    this.statsCache = null;
  }

  beginCooling(now: number): void {
    if (this.coolingStartTime === null) {
      this.coolingStartTime = now;
    }
  }

  getTemperature(now: number): number {
    if (this.coolingStartTime === null) {
      return this.pourTemperature;
    }
    const elapsed = (now - this.coolingStartTime) / 1000;
    if (elapsed <= 0) {
      return this.pourTemperature;
    }
    return 100 + (this.pourTemperature - 100) * Math.exp(-DECAY_CONSTANT * elapsed);
  }

  getCoolingProgress(now: number): number {
    const span = this.pourTemperature - COOLED_THRESHOLD;
    if (span <= 0) return 1;
    return clamp((this.pourTemperature - this.getTemperature(now)) / span, 0, 1);
  }

  isCooled(now: number): boolean {
    return this.getTemperature(now) <= COOLED_THRESHOLD;
  }

  isQuenched(): boolean {
    return this.quenchedFlag;
  }

  isInspected(): boolean {
    return this.inspectedFlag;
  }

  getStage(now: number): CastingStage {
    if (this.inspectedFlag) return 'inspected';
    if (this.quenchedFlag) return 'quenched';
    if (this.isCooled(now)) return 'cooled';
    return 'cooling';
  }

  getStats(): CastingStats | null {
    return this.statsCache ? { ...this.statsCache } : null;
  }

  quench(now: number): CastingResult {
    if (!this.isCooled(now)) {
      return { ok: false, reason: '铸件尚未冷却完成，无法淬火！' };
    }
    if (this.quenchedFlag) {
      return { ok: false, reason: '该铸件已淬火，无需重复淬火！' };
    }
    this.quenchedFlag = true;
    return { ok: true };
  }

  canInspect(now: number): boolean {
    return this.isCooled(now) && this.quenchedFlag && !this.inspectedFlag;
  }

  inspect(now: number): CastingResult {
    if (!this.isCooled(now)) {
      return { ok: false, reason: '铸件尚未冷却完成，不能送检！' };
    }
    if (!this.quenchedFlag) {
      return { ok: false, reason: '铸件尚未淬火，不能送检！' };
    }
    if (this.inspectedFlag) {
      return { ok: false, reason: '该铸件已完成质检，请勿重复送检！' };
    }
    this.inspectedFlag = true;
    this.statsCache = this.computeStats();
    return { ok: true, stats: { ...this.statsCache } };
  }

  private computeStats(): CastingStats {
    const tempFactor = clamp((this.pourTemperature - 1200) / 400, 0, 1);
    const seed = hashId(this.id);
    const jitter = (shift: number): number => ((seed >>> shift) & 7) - 3;
    const quenchBonus = this.quenchedFlag ? 8 : 0;
    return {
      hardness: clamp(Math.round(62 + tempFactor * 28 + quenchBonus + jitter(0)), 0, 100),
      toughness: clamp(Math.round(62 + tempFactor * 24 + jitter(3)), 0, 100),
      sharpness: clamp(Math.round(62 + tempFactor * 26 + Math.floor(quenchBonus / 2) + jitter(6)), 0, 100)
    };
  }
}
