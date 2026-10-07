// 第三层（推演引擎）：缓存 / 量化复用 / 参数修正后的增量重推 / 批量推演。
// 渲染层只通过本引擎取得 SimulationFrame，不再自行计算角度。
import type {
  BatchResult,
  BodyPosition,
  ObserverView,
  OrbitalBodyParams,
  RingKey,
  SimulationConfig,
  SimulationFrame,
  TimeRange
} from './types.ts';
import { DEFAULT_CONFIG } from './types.ts';
import { buildRingFrames, canonicalJSON, stableHash, type RingFrameSet } from './math.ts';
import { buildViewBasis, computeBodyPosition, type ViewBasis } from './orbits.ts';
import { computeOcclusion } from './occlusion.ts';

export type RingTiltSet = Partial<Record<RingKey, number>>;

export interface BodyUpdate {
  id: string;
  patch: Partial<Omit<OrbitalBodyParams, 'id' | 'revision'>>;
  /** 生效起始时刻（毫秒）；缺省表示从最早时刻起全量替换该星体参数 */
  effectiveFrom?: number;
  /** 是否自动递增 revision（默认 true） */
  bumpRevision?: boolean;
}

interface TimedParams {
  params: OrbitalBodyParams;
  effectiveFrom: number;
  exists: boolean;
}

export interface EngineStats {
  frameHits: number;
  frameMisses: number;
  positionRecomputed: number;
  positionReused: number;
  framesInvalidated: number;
}

const POSITION_CACHE_LIMIT = 50000;

/** 哈希前把浮点规整到 12 位有效精度，并消除 -0，保证等价代码路径指纹一致 */
function roundValue(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const r = Math.round(value * 1e12) / 1e12;
    return Object.is(r, -0) ? 0 : r;
  }
  if (Array.isArray(value)) return value.map(roundValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) out[k] = roundValue(val);
    return out;
  }
  return value;
}

export class SimulationEngine {
  /** 每颗星体的参数时间线（按 effectiveFrom 升序），修正后旧时刻仍取旧参数 */
  private timeline = new Map<string, TimedParams[]>();
  private latest: OrbitalBodyParams[];
  private observer: ObserverView;
  private config: SimulationConfig;
  private frames: RingFrameSet;
  private view: ViewBasis;

  private frameCache = new Map<number, SimulationFrame>();
  private positionCache = new Map<string, BodyPosition>();
  private tiltVersion = 0;
  private observerVersion = 0;

  readonly stats: EngineStats = {
    frameHits: 0,
    frameMisses: 0,
    positionRecomputed: 0,
    positionReused: 0,
    framesInvalidated: 0
  };

  constructor(
    bodies: OrbitalBodyParams[],
    observer: ObserverView,
    config: SimulationConfig = DEFAULT_CONFIG
  ) {
    // 按 id 排序拷贝，保证推演结果与传入顺序无关
    this.latest = bodies.map((b) => ({ ...b })).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const body of this.latest) {
      this.timeline.set(body.id, [{ params: { ...body }, effectiveFrom: -Infinity, exists: true }]);
    }
    this.observer = {
      position: [...observer.position] as ObserverView['position'],
      target: [...observer.target] as ObserverView['target']
    };
    this.config = { ...config };
    this.frames = buildRingFrames();
    this.view = buildViewBasis(this.observer);
  }

  /** 当前（最新）星体参数 */
  getBodies(): OrbitalBodyParams[] {
    return this.latest.map((b) => ({ ...b }));
  }

  getConfig(): SimulationConfig {
    return { ...this.config };
  }

  getObserver(): ObserverView {
    return {
      position: [...this.observer.position] as ObserverView['position'],
      target: [...this.observer.target] as ObserverView['target']
    };
  }

  /**
   * 新增星体（例如观星台点击主星生成新行星）。
   * effectiveFrom 之前的帧不包含该星体（遮挡集合也不受影响）。
   */
  addBody(body: OrbitalBodyParams, effectiveFrom?: number): OrbitalBodyParams {
    const entry: OrbitalBodyParams = { ...body };
    if (this.latest.some((b) => b.id === entry.id)) throw new Error(`duplicate body: ${entry.id}`);
    this.latest.push(entry);
    this.latest.sort((a, b) => (a.id < b.id ? -1 : 1));
    const from = effectiveFrom ?? -Infinity;
    this.timeline.set(entry.id,
      from === -Infinity
        ? [{ params: { ...entry }, effectiveFrom: -Infinity, exists: true }]
        : [
            { params: { ...entry }, effectiveFrom: -Infinity, exists: false },
            { params: { ...entry }, effectiveFrom: from, exists: true }
          ]
    );
    this.invalidateFrames(from);
    this.trimPositionCache();
    return { ...entry };
  }

  /** 指定时刻实际存在并生效的星体参数（内部 + 外部校验可用） */
  paramsAt(time: number): OrbitalBodyParams[] {
    const out: OrbitalBodyParams[] = [];
    for (const body of this.latest) {
      const chosen = this.selectEntry(body.id, time);
      if (chosen.exists) out.push(chosen.params);
    }
    return out;
  }

  /** 量化时刻：同一时间桶复用同一结果，快速拖动不漂移 */
  quantize(time: number): number {
    return Math.round(time / this.config.timeQuantumMs) * this.config.timeQuantumMs;
  }

  /** 用户拖拽星环倾角：倾角版本号变化令位置/帧缓存失效，角度在推演层重算 */
  setRingTilt(tilt: RingTiltSet): void {
    this.frames = buildRingFrames(tilt);
    this.tiltVersion += 1;
    this.invalidateFrames(-Infinity);
  }

  setObserver(observer: ObserverView): void {
    this.observer = {
      position: [...observer.position] as ObserverView['position'],
      target: [...observer.target] as ObserverView['target']
    };
    this.view = buildViewBasis(this.observer);
    this.observerVersion += 1;
    this.invalidateFrames(-Infinity);
  }

  /**
   * 修正轨道参数：
   *  - 在参数时间线上追加一条“effectiveFrom 起生效”的新版本，旧时刻保持旧参数；
   *  - 只令 effectiveFrom 之后的帧缓存失效；
   *  - 位置缓存以 (id, revision, tiltVersion, observerVersion, time) 为键，
   *    未受影响星体 / 未生效区间的几何结果原样复用，遮挡按帧重算，与整体重推一致。
   */
  updateBody(update: BodyUpdate): OrbitalBodyParams {
    const index = this.latest.findIndex((b) => b.id === update.id);
    if (index < 0) throw new Error(`unknown body: ${update.id}`);
    const previous = this.latest[index];
    const next: OrbitalBodyParams = {
      ...previous,
      ...update.patch,
      id: update.id,
      revision:
        update.bumpRevision === false ? previous.revision : previous.revision + 1
    };
    this.latest[index] = next;

    const entries = this.timeline.get(update.id)!;
    const from = update.effectiveFrom ?? -Infinity;
    if (from === -Infinity) {
      entries.length = 0;
      entries.push({ params: { ...next }, effectiveFrom: -Infinity, exists: true });
    } else {
      // 同一生效时刻以最新写入为准；去掉 effectiveFrom 不早于本次的旧条目
      const kept = entries.filter((e) => e.effectiveFrom < from);
      kept.push({ params: { ...next }, effectiveFrom: from, exists: true });
      this.timeline.set(update.id, kept);
    }

    this.invalidateFrames(from);
    this.trimPositionCache();
    return { ...next };
  }

  private invalidateFrames(fromTime: number): void {
    if (fromTime === -Infinity) {
      this.stats.framesInvalidated += this.frameCache.size;
      this.frameCache.clear();
      return;
    }
    for (const key of [...this.frameCache.keys()]) {
      if (key >= fromTime) {
        this.frameCache.delete(key);
        this.stats.framesInvalidated += 1;
      }
    }
  }

  private trimPositionCache(): void {
    if (this.positionCache.size <= POSITION_CACHE_LIMIT) return;
    const excess = this.positionCache.size - POSITION_CACHE_LIMIT;
    let removed = 0;
    for (const key of this.positionCache.keys()) {
      this.positionCache.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }

  private selectEntry(bodyId: string, time: number): TimedParams {
    const entries = this.timeline.get(bodyId)!;
    let chosen = entries[0];
    for (const entry of entries) {
      if (entry.effectiveFrom <= time) chosen = entry;
      else break;
    }
    return chosen;
  }

  private positionKey(bodyId: string, revision: number, time: number): string {
    return `${bodyId}|${revision}|${this.tiltVersion}|${this.observerVersion}|${time}`;
  }

  private getBodyPosition(body: OrbitalBodyParams, time: number): BodyPosition {
    const key = this.positionKey(body.id, body.revision, time);
    const cached = this.positionCache.get(key);
    if (cached) {
      this.stats.positionReused += 1;
      return cached;
    }
    const result = computeBodyPosition(body, time, this.frames, this.view);
    this.positionCache.set(key, result);
    this.stats.positionRecomputed += 1;
    return result;
  }

  /** 推演指定时刻（量化后），重复调用直接复用缓存帧 */
  getFrame(time: number): SimulationFrame {
    const t = this.quantize(time);
    const cached = this.frameCache.get(t);
    if (cached) {
      this.stats.frameHits += 1;
      return cached;
    }
    this.stats.frameMisses += 1;
    const paramsAtT = this.paramsAt(t);
    const positions = paramsAtT.map((body) => this.getBodyPosition(body, t));
    const { relations, visibilities } = computeOcclusion(positions, paramsAtT, this.config);
    const frame: SimulationFrame = {
      time: t,
      bodies: positions,
      visibilities,
      occlusions: relations,
      hash: ''
    };
    frame.hash = this.computeHash(frame);
    this.frameCache.set(t, frame);
    return frame;
  }

  private computeHash(frame: Omit<SimulationFrame, 'hash'>): string {
    const payload = {
      time: frame.time,
      bodies: frame.bodies.map((b) => ({
        id: b.id,
        angles: b.angles,
        position: b.position,
        viewAngle: b.viewAngle,
        viewDepth: b.viewDepth,
        viewX: b.viewX,
        viewY: b.viewY,
        revision: b.revision
      })),
      visibilities: frame.visibilities,
      occlusions: frame.occlusions
    };
    return stableHash(roundValue(payload));
  }

  /** 当前引擎状态下对时刻区间批量推演 */
  runRange(range: TimeRange): BatchResult {
    if (range.step <= 0) throw new Error('step must be positive');
    const frames: SimulationFrame[] = [];
    const startQ = this.quantize(range.start);
    const endQ = this.quantize(range.end);
    for (let t = startQ; t <= endQ; t += range.step) {
      frames.push(this.getFrame(t));
    }
    return {
      frames,
      bodyIds: this.latest.map((b) => b.id),
      config: { ...this.config }
    };
  }

  /**
   * 增量一致性自检：另一台引擎整体重推同一区间，逐帧比对。
   * 另一台引擎须通过相同的 updateBody 序列构造，保证参数时间线一致。
   * 返回不一致的时刻列表（为空则增量重推与整体重推完全一致）。
   */
  diffAgainstFresh(other: SimulationEngine, range: TimeRange): number[] {
    const mismatches: number[] = [];
    const startQ = this.quantize(range.start);
    const endQ = this.quantize(range.end);
    for (let t = startQ; t <= endQ; t += range.step) {
      const a = this.getFrame(t);
      const b = other.getFrame(t);
      if (
        a.hash !== b.hash ||
        canonicalJSON(roundValue(stripHash(a))) !== canonicalJSON(roundValue(stripHash(b)))
      ) {
        mismatches.push(t);
      }
    }
    return mismatches;
  }
}

function stripHash(frame: SimulationFrame): Omit<SimulationFrame, 'hash'> {
  return {
    time: frame.time,
    bodies: frame.bodies,
    visibilities: frame.visibilities,
    occlusions: frame.occlusions
  };
}
