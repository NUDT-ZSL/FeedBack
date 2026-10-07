// 批量推演 + 一致性校验（浏览器与 Node 共享，不依赖任何宿主 API）。
import { SimulationEngine } from './engine.ts';
import { generateBodies, mulberry32 } from './scenario.ts';
import { computeOcclusion } from './occlusion.ts';
import {
  DEFAULT_CONFIG,
  type BodyPosition,
  type ObserverView,
  type OrbitalBodyParams,
  type SimulationConfig
} from './index.ts';

export interface VerifyOptions {
  start: number;
  end: number;
  step: number;
  bodies: number;
  seed: number;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerifyReport {
  scenario: VerifyOptions;
  counts: { occlusionFrames: number; totalOcclusions: number };
  stats: import('./engine.ts').EngineStats;
  results: CheckResult[];
  passed: boolean;
}

export const DEFAULT_VERIFY_OPTIONS: VerifyOptions = {
  start: 0,
  end: 120_000,
  step: 500,
  bodies: 30,
  seed: 42
};

export const OBSERVER: ObserverView = { position: [0, 4, 14], target: [0, 0, 0] };

function shuffle<T>(items: T[], rand: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 朴素 O(n²) 遮挡判定（验证基准，不使用空间网格） */
function bruteForceOcclusion(
  positions: BodyPosition[],
  bodies: OrbitalBodyParams[],
  config: SimulationConfig
): string[] {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const params = new Map(bodies.map((b) => [b.id, b]));
  const hiddenBy = new Map<string, string>();
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const p = positions[i];
      const q = positions[j];
      let minDiff = Infinity;
      for (const ring of ['ecliptic', 'equator', 'galactic'] as const) {
        const a = p.angles[ring];
        const b = q.angles[ring];
        if (a === null || b === null) continue;
        let d = Math.abs(((a - b) % 360) + 360) % 360;
        if (d > 180) d = 360 - d;
        if (d < minDiff) minDiff = d;
      }
      const sep = Math.hypot(p.viewX - q.viewX, p.viewY - q.viewY);
      if (minDiff >= config.angleThresholdDeg || sep >= config.angularSeparationRad) continue;
      let frontId: string;
      if (Math.abs(p.viewDepth - q.viewDepth) >= config.depthEpsilon) {
        frontId = p.viewDepth < q.viewDepth ? p.id : q.id;
      } else {
        const mp = params.get(p.id)!.magnitude;
        const mq = params.get(q.id)!.magnitude;
        if (mp !== mq) frontId = mp < mq ? p.id : q.id;
        else frontId = params.get(p.id)!.depthOrder <= params.get(q.id)!.depthOrder ? p.id : q.id;
      }
      const hiddenId = frontId === p.id ? q.id : p.id;
      const occluder = hiddenBy.get(hiddenId);
      const sepExisting =
        occluder !== undefined
          ? Math.hypot(byId.get(occluder)!.viewX - byId.get(hiddenId)!.viewX, byId.get(occluder)!.viewY - byId.get(hiddenId)!.viewY)
          : Infinity;
      if (sep < sepExisting) hiddenBy.set(hiddenId, frontId);
    }
  }
  return [...hiddenBy.entries()].map(([hiddenId, visibleId]) => `${visibleId}>${hiddenId}`).sort();
}

export function runVerification(options: Partial<VerifyOptions> = {}): VerifyReport {
  const args = { ...DEFAULT_VERIFY_OPTIONS, ...options };
  const results: CheckResult[] = [];
  const check = (name: string, passed: boolean, detail: string) => results.push({ name, passed, detail });

  const bodies = generateBodies(args.bodies, args.seed);
  const engine = new SimulationEngine(bodies, OBSERVER, { ...DEFAULT_CONFIG });
  const times: number[] = [];
  for (let t = args.start; t <= args.end; t += args.step) times.push(t);

  // 1) 确定性：前向、后向、重复乱序推演，指纹一致
  const hashesA = new Map<number, string>();
  for (const t of times) hashesA.set(t, engine.getFrame(t).hash);
  let drift = 0;
  for (const t of shuffle([...times, ...times], mulberry32(args.seed))) {
    if (engine.getFrame(t).hash !== hashesA.get(engine.quantize(t))) drift++;
  }
  check('重复/乱序推演指纹一致', drift === 0, drift === 0 ? `${times.length} 时刻 × 乱序+重复全部一致` : `${drift} 次漂移`);

  // 量化桶内复用
  const q = DEFAULT_CONFIG.timeQuantumMs;
  const q0 = engine.getFrame(args.start + q * 0.2);
  const q1 = engine.getFrame(args.start + q * 0.28);
  check('时间量化桶内结果复用', q0 === q1, `桶内两次调用返回同一帧 time=${q0.time}`);

  // 独立整体重推（含乱序输入）
  const fresh = new SimulationEngine(shuffle(bodies, mulberry32(args.seed + 7)), OBSERVER, { ...DEFAULT_CONFIG });
  let freshMismatch = 0;
  for (const t of times) if (fresh.getFrame(t).hash !== hashesA.get(engine.quantize(t))) freshMismatch++;
  check('独立整体重推一致（含乱序输入）', freshMismatch === 0, freshMismatch === 0 ? `${times.length} 帧一致` : `${freshMismatch} 帧不一致`);

  // 2) 遮挡依据完整合法
  const occlusionFrames = times.map((t) => engine.getFrame(t)).filter((f) => f.occlusions.length > 0);
  let evidenceBad = 0;
  for (const f of occlusionFrames) {
    for (const rel of f.occlusions) {
      const e = rel.evidence;
      if (
        !(e.angleDiffDeg >= 0 && e.angleDiffDeg < DEFAULT_CONFIG.angleThresholdDeg) ||
        !(e.viewSeparationRad < DEFAULT_CONFIG.angularSeparationRad) ||
        !(e.tieBreak === 'depth' || e.tieBreak === 'magnitude' || e.tieBreak === 'order') ||
        !(e.depthVisible <= e.depthHidden + DEFAULT_CONFIG.depthEpsilon)
      ) {
        evidenceBad++;
      }
    }
  }
  check(
    '遮挡结论均含明确且合法的判定依据',
    occlusionFrames.length > 0 && evidenceBad === 0,
    `${occlusionFrames.length} 帧含遮挡关系，${evidenceBad === 0 ? '依据全部合法' : `${evidenceBad} 条异常`}`
  );

  // 网格筛选 vs O(n²)
  let pairMismatch = 0;
  const sampleRand = mulberry32(args.seed + 99);
  for (let i = 0; i < Math.min(10, times.length); i++) {
    const t = times[Math.floor(sampleRand() * times.length)];
    const frame = engine.getFrame(t);
    const expected = bruteForceOcclusion(frame.bodies, engine.paramsAt(frame.time), DEFAULT_CONFIG);
    const actual = frame.occlusions.map((o) => `${o.visibleId}>${o.hiddenId}`).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) pairMismatch++;
  }
  check('空间网格遮挡判定与 O(n²) 基准一致', pairMismatch === 0, pairMismatch === 0 ? '10 个抽样时刻一致' : `${pairMismatch} 个时刻不一致`);

  // 3) 帧缓存命中
  const before = engine.stats.frameHits;
  for (const t of times) engine.getFrame(t);
  const gainedHits = engine.stats.frameHits - before;
  check('已推演时刻复用结果（帧缓存）', gainedHits === times.length, `${gainedHits}/${times.length} 次帧命中`);

  // 4) 增量重推
  const targetBody = bodies[2 % bodies.length];
  const effectiveFrom = times[Math.floor(times.length / 3)];
  engine.getFrame(effectiveFrom);
  const changed = engine.updateBody({ id: targetBody.id, patch: { period: targetBody.period * 0.8, inclination: 5 }, effectiveFrom });
  const freshBefore = new SimulationEngine(bodies, OBSERVER, { ...DEFAULT_CONFIG });
  const freshAfter = new SimulationEngine(bodies.map((b) => (b.id === targetBody.id ? { ...changed } : b)), OBSERVER, { ...DEFAULT_CONFIG });
  let incrMismatch = 0;
  let untouchedChanged = 0;
  for (const t of times) {
    const a = engine.getFrame(t);
    const b = (t < effectiveFrom ? freshBefore : freshAfter).getFrame(t);
    if (a.hash !== b.hash) incrMismatch++;
    if (t < effectiveFrom && a.bodies.find((x) => x.id === targetBody.id)!.revision !== 0) untouchedChanged++;
  }
  check('参数修正后增量重推与整体重推逐帧一致', incrMismatch === 0, incrMismatch === 0 ? `${times.length} 帧一致` : `${incrMismatch} 帧不一致`);
  check(
    '仅生效区间之后重推受影响星体',
    untouchedChanged === 0,
    untouchedChanged === 0 ? `t < ${effectiveFrom}ms 的帧未受影响` : `${untouchedChanged} 个未生效帧被误重推`
  );

  const unvisitedOld = args.start - args.step;
  const lateOldOk = engine.getFrame(unvisitedOld).hash === freshBefore.getFrame(unvisitedOld).hash;
  check('修正后首次访问未生效区间仍用旧参数', lateOldOk, `t=${unvisitedOld}ms ${lateOldOk ? '一致' : '被污染'}`);

  // 5) 规模
  const scaleBodies = Math.max(args.bodies * 6, 300);
  const scaleCount = Math.ceil((args.end - args.start) / args.step) + 1;
  const scaleEngine = new SimulationEngine(generateBodies(scaleBodies, args.seed), OBSERVER, { ...DEFAULT_CONFIG });
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const batch = scaleEngine.runRange({ start: args.start, end: args.end, step: args.step });
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  let scaleMismatch = 0;
  for (const f of [batch.frames[0], batch.frames[Math.floor(batch.frames.length / 2)], batch.frames[batch.frames.length - 1]]) {
    const expected = bruteForceOcclusion(f.bodies, scaleEngine.paramsAt(f.time), DEFAULT_CONFIG);
    const actual = f.occlusions.map((o) => `${o.visibleId}>${o.hiddenId}`).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) scaleMismatch++;
  }
  check(
    `规模场景（${scaleBodies} 星体 × ${scaleCount} 时刻）性能与正确性`,
    batch.frames.length === scaleCount && scaleMismatch === 0 && elapsed < 5000,
    `${batch.frames.length} 帧 / ${elapsed.toFixed(1)}ms`
  );

  const passed = results.every((r) => r.passed);
  return {
    scenario: args,
    counts: {
      occlusionFrames: occlusionFrames.length,
      totalOcclusions: occlusionFrames.reduce((s, f) => s + f.occlusions.length, 0)
    },
    stats: engine.stats,
    results,
    passed
  };
}

// 供外部（CLI）复用的朴素判定，便于扩展
export { computeOcclusion };
