import { LruCache } from './cache';
import { computeEphemeris } from './ephemeris';
import { assembleBodyStates, computeOcclusions } from './occlusion';
import type {
  BodyEphemeris,
  DeductionSnapshot,
  EngineStats,
  ObserverViewpoint,
  OrbitalParams,
  RingConfig,
  RingType
} from './types';

export interface DeductionEngineOptions {
  rings: RingConfig[];
  observer: ObserverViewpoint;
  /** 遮挡判定角距阈值，度，默认 2 */
  occlusionThresholdDeg?: number;
  /** 观测时刻量化步长，秒，默认 0.01。同一量化时刻的推演结果恒定且可复用 */
  timeStep?: number;
  cacheCapacity?: number;
}

interface SnapshotEntry {
  stamp: string;
  snapshot: DeductionSnapshot;
  /** 区间化参数修正时，区间外被调用方声明为不受影响的缓存项 */
  frozen: boolean;
}

/**
 * 推演引擎：把"星历计算 -> 遮挡判定 -> 快照组装"组织成可独立验证的纯数据层。
 *
 * 确定性：所有输出都是 (轨道参数, 环配置, 观测者, 量化时刻) 的纯函数，
 * 与渲染帧率、时间轴拖动速度无关。
 *
 * 增量重推：星历按 (星体, 参数版本, 量化时刻) 缓存；修正某星体轨道参数
 * 只会使该星体的星历失效，其余星体直接复用；快照按版本戳惰性失效，
 * 只有被实际请求的时刻才会重算。
 */
export class DeductionEngine {
  private readonly rings = new Map<RingType, RingConfig>();
  private readonly bodies = new Map<number, OrbitalParams>();
  private readonly revisions = new Map<number, number>();
  private configRevision = 0;
  private observer: ObserverViewpoint;
  private readonly occlusionThresholdDeg: number;
  private readonly timeStep: number;
  private readonly ephemerisCache: LruCache<string, BodyEphemeris>;
  private readonly snapshotCache: LruCache<number, SnapshotEntry>;
  private readonly stats: EngineStats = {
    ephemerisHits: 0,
    ephemerisMisses: 0,
    snapshotHits: 0,
    snapshotMisses: 0
  };

  constructor(options: DeductionEngineOptions) {
    for (const ring of options.rings) {
      this.rings.set(ring.type, { ...ring });
    }
    this.observer = { position: [...options.observer.position] };
    this.occlusionThresholdDeg = options.occlusionThresholdDeg ?? 2;
    this.timeStep = options.timeStep ?? 0.01;
    const capacity = options.cacheCapacity ?? 8192;
    this.ephemerisCache = new LruCache(capacity * 4);
    this.snapshotCache = new LruCache(capacity);
  }

  // ---------- 输入管理 ----------

  setBodies(list: OrbitalParams[]): void {
    for (const params of list) {
      this.addBody(params);
    }
  }

  addBody(params: OrbitalParams): void {
    this.bodies.set(params.bodyId, { ...params });
    this.revisions.set(params.bodyId, (this.revisions.get(params.bodyId) ?? 0) + 1);
  }

  removeBody(bodyId: number): void {
    this.bodies.delete(bodyId);
    this.revisions.delete(bodyId);
    this.purgeEphemeris(bodyId);
  }

  /**
   * 修正单个星体的轨道参数。
   * 只让该星体的星历缓存失效；其余星体、其余时刻的结果保持复用。
   * 传入 affectedRange 时，调用方声明该修正只影响此时刻区间：
   * 区间内的快照缓存被丢弃重推，区间外的缓存被信任并继续复用。
   */
  updateOrbitalParams(
    bodyId: number,
    patch: Partial<Omit<OrbitalParams, 'bodyId'>>,
    affectedRange?: [number, number]
  ): void {
    const current = this.bodies.get(bodyId);
    if (!current) {
      throw new Error(`unknown body: ${bodyId}`);
    }
    this.bodies.set(bodyId, { ...current, ...patch, bodyId });
    this.revisions.set(bodyId, (this.revisions.get(bodyId) ?? 0) + 1);
    this.purgeEphemeris(bodyId);
    if (affectedRange) {
      const [t0, t1] = affectedRange;
      for (const key of [...this.snapshotCache.keys()]) {
        const time = key * this.timeStep;
        if (time >= t0 && time <= t1) {
          this.snapshotCache.delete(key);
        } else {
          const entry = this.snapshotCache.peek(key);
          if (entry) {
            entry.frozen = true;
          }
        }
      }
    }
  }

  setRingConfig(type: RingType, patch: Partial<Omit<RingConfig, 'type'>>): void {
    const current = this.rings.get(type);
    if (!current) {
      throw new Error(`unknown ring: ${type}`);
    }
    this.rings.set(type, { ...current, ...patch, type });
    this.configRevision += 1;
  }

  getRingConfig(type: RingType): RingConfig {
    const ring = this.rings.get(type);
    if (!ring) {
      throw new Error(`unknown ring: ${type}`);
    }
    return { ...ring };
  }

  setObserver(observer: ObserverViewpoint): void {
    this.observer = { position: [...observer.position] };
  }

  // ---------- 推演 ----------

  /** 把任意观测时刻量化到固定步长，保证重复推演落在同一缓存键上。 */
  quantizeTime(time: number): number {
    return Math.round(time / this.timeStep) * this.timeStep;
  }

  getSnapshot(time: number): DeductionSnapshot {
    const key = Math.round(time / this.timeStep);
    const quantized = key * this.timeStep;
    const stamp = this.computeStamp();
    const cached = this.snapshotCache.get(key);
    if (cached && (cached.stamp === stamp || cached.frozen)) {
      this.stats.snapshotHits += 1;
      return cached.snapshot;
    }
    this.stats.snapshotMisses += 1;

    const bodies = [...this.bodies.values()].sort((a, b) => a.bodyId - b.bodyId);
    const ephemerides = bodies.map((params) => this.getEphemeris(params, key, quantized));
    const occlusion = computeOcclusions(ephemerides, this.observer, this.occlusionThresholdDeg);
    const snapshot: DeductionSnapshot = {
      time: quantized,
      bodies: assembleBodyStates(ephemerides, occlusion),
      occlusions: occlusion.verdicts
    };
    this.snapshotCache.set(key, { stamp, snapshot, frozen: false });
    return snapshot;
  }

  /** 批量推演一个时刻区间，用于脱离渲染层的一致性核对。 */
  batchDeduce(startTime: number, endTime: number, step: number): DeductionSnapshot[] {
    const stride = Math.max(1, Math.round(step / this.timeStep));
    const first = Math.ceil(startTime / this.timeStep);
    const last = Math.floor(endTime / this.timeStep);
    const snapshots: DeductionSnapshot[] = [];
    for (let key = first; key <= last; key += stride) {
      snapshots.push(this.getSnapshot(key * this.timeStep));
    }
    return snapshots;
  }

  getStats(): EngineStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats.ephemerisHits = 0;
    this.stats.ephemerisMisses = 0;
    this.stats.snapshotHits = 0;
    this.stats.snapshotMisses = 0;
  }

  // ---------- 内部 ----------

  private getEphemeris(params: OrbitalParams, key: number, time: number): BodyEphemeris {
    const revision = this.revisions.get(params.bodyId) ?? 0;
    const cacheKey = `${params.bodyId}:${revision}:${key}`;
    const cached = this.ephemerisCache.get(cacheKey);
    if (cached) {
      this.stats.ephemerisHits += 1;
      return cached;
    }
    this.stats.ephemerisMisses += 1;
    const ring = this.rings.get(params.ring);
    if (!ring) {
      throw new Error(`unknown ring: ${params.ring}`);
    }
    const ephemeris = computeEphemeris(params, ring, time);
    this.ephemerisCache.set(cacheKey, ephemeris);
    return ephemeris;
  }

  private purgeEphemeris(bodyId: number): void {
    const prefix = `${bodyId}:`;
    for (const key of [...this.ephemerisCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.ephemerisCache.delete(key);
      }
    }
  }

  private computeStamp(): string {
    const parts: string[] = [`cfg${this.configRevision}`, this.observerKey()];
    const ids = [...this.revisions.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      parts.push(`${id}r${this.revisions.get(id)}`);
    }
    return parts.join('|');
  }

  private observerKey(): string {
    const [x, y, z] = this.observer.position;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return `obs${round(x)},${round(y)},${round(z)}`;
  }
}

/** 结构化稳定的序列化，用于跨引擎/跨批次核对推演结果一致性。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

export function snapshotsEqual(a: DeductionSnapshot, b: DeductionSnapshot): boolean {
  return stableStringify(a) === stableStringify(b);
}
