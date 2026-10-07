// 第二层：遮挡判定。基于第一层的位置/角度结果 + 观测者视角，给出明确的遮挡结论与依据。
// 判定规则（确定性，与星体遍历顺序无关）：
//   1) 两星体在任一环带上的角度差 < angleThresholdDeg，且视线方向视位置角距 < angularSeparationRad，构成遮挡候选；
//   2) 候选之间按 viewDepth 决胜（小者可见）；深度差 < depthEpsilon 时按视星等（亮者可见）；
//      仍相同则按 depthOrder（稳定序号，小者可见）—— 任何情况下都有唯一结论。
import type {
  BodyPosition,
  BodyVisibility,
  OcclusionEvidence,
  OcclusionRelation,
  OrbitalBodyParams,
  RingKey,
  SimulationConfig
} from './types.ts';
import { RING_KEYS } from './types.ts';
import { angleDiffDeg } from './math.ts';

interface CandidatePair {
  a: BodyPosition;
  b: BodyPosition;
  ring: RingKey;
  angleDiffDeg: number;
  viewSeparationRad: number;
}

/** 视图平面空间网格：把 O(n²) 候选筛选降为近线性，星体增多时仍保持性能 */
function collectCandidatePairs(
  positions: BodyPosition[],
  config: SimulationConfig
): CandidatePair[] {
  const cellSize = Math.max(config.angularSeparationRad, 1e-6);
  const grid = new Map<string, BodyPosition[]>();
  const cellKey = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;

  for (const p of positions) {
    const key = cellKey(p.viewX, p.viewY);
    const bucket = grid.get(key);
    if (bucket) bucket.push(p);
    else grid.set(key, [p]);
  }

  const pairs: CandidatePair[] = [];
  const seen = new Set<string>();

  for (const p of positions) {
    const cx = Math.floor(p.viewX / cellSize);
    const cy = Math.floor(p.viewY / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const q of bucket) {
          if (q.id === p.id) continue;
          const pairKey = p.id < q.id ? `${p.id}${q.id}` : `${q.id}${p.id}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          const pair = evaluatePair(p, q, config);
          if (pair) pairs.push(pair);
        }
      }
    }
  }

  // 排序保证输出顺序确定，与网格遍历顺序无关
  pairs.sort((x, y) => {
    const ka = x.a.id < x.b.id ? x.a.id + x.b.id : x.b.id + x.a.id;
    const kb = y.a.id < y.b.id ? y.a.id + y.b.id : y.b.id + y.a.id;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return pairs;
}

function evaluatePair(
  p: BodyPosition,
  q: BodyPosition,
  config: SimulationConfig
): CandidatePair | null {
  // 条件一：任一环带上角度差小于阈值（取角距最小的环带作为判定依据）
  let bestRing: RingKey | null = null;
  let bestDiff = Infinity;
  for (const ring of RING_KEYS) {
    const a = p.angles[ring];
    const b = q.angles[ring];
    if (a === null || b === null) continue;
    const diff = angleDiffDeg(a, b);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRing = ring;
    }
  }
  if (bestRing === null || bestDiff >= config.angleThresholdDeg) return null;

  // 条件二：视线方向视位置角距（投影重叠）
  const viewSep = Math.hypot(p.viewX - q.viewX, p.viewY - q.viewY);
  if (viewSep >= config.angularSeparationRad) return null;

  return { a: p, b: q, ring: bestRing, angleDiffDeg: bestDiff, viewSeparationRad: viewSep };
}

/** 决胜规则：返回在前的星体 id 及所用规则 */
function resolveFront(
  p: BodyPosition,
  q: BodyPosition,
  params: Map<string, OrbitalBodyParams>,
  config: SimulationConfig
): { frontId: string; tieBreak: OcclusionEvidence['tieBreak'] } {
  if (Math.abs(p.viewDepth - q.viewDepth) >= config.depthEpsilon) {
    return { frontId: p.viewDepth < q.viewDepth ? p.id : q.id, tieBreak: 'depth' };
  }
  const mp = params.get(p.id)!.magnitude;
  const mq = params.get(q.id)!.magnitude;
  if (mp !== mq) return { frontId: mp < mq ? p.id : q.id, tieBreak: 'magnitude' };
  const op = params.get(p.id)!.depthOrder;
  const oq = params.get(q.id)!.depthOrder;
  return { frontId: op <= oq ? p.id : q.id, tieBreak: 'order' };
}

export interface OcclusionOutcome {
  relations: OcclusionRelation[];
  visibilities: BodyVisibility[];
}

export function computeOcclusion(
  positions: BodyPosition[],
  bodies: OrbitalBodyParams[],
  config: SimulationConfig
): OcclusionOutcome {
  const params = new Map(bodies.map((b) => [b.id, b]));
  const pairs = collectCandidatePairs(positions, config);

  // 每个被遮挡者只归属一个遮挡者：视位置角距最小者，并列取 id 较小者（确定性）
  const hiddenByBest = new Map<string, { frontId: string; pair: CandidatePair; tieBreak: OcclusionEvidence['tieBreak'] }>();

  for (const pair of pairs) {
    const { frontId, tieBreak } = resolveFront(pair.a, pair.b, params, config);
    const hiddenId = frontId === pair.a.id ? pair.b.id : pair.a.id;
    const prev = hiddenByBest.get(hiddenId);
    if (
      !prev ||
      pair.viewSeparationRad < prev.pair.viewSeparationRad - 1e-12 ||
      (Math.abs(pair.viewSeparationRad - prev.pair.viewSeparationRad) <= 1e-12 && frontId < prev.frontId)
    ) {
      hiddenByBest.set(hiddenId, { frontId, pair, tieBreak });
    }
  }

  const relations: OcclusionRelation[] = [];
  const occludesMap = new Map<string, string[]>();
  const hiddenByMap = new Map<string, string>();

  const entries = [...hiddenByBest.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [hiddenId, { frontId, pair, tieBreak }] of entries) {
    const front = pair.a.id === frontId ? pair.a : pair.b;
    const hidden = pair.a.id === hiddenId ? pair.a : pair.b;
    relations.push({
      visibleId: frontId,
      hiddenId,
      evidence: {
        ring: pair.ring,
        angleDiffDeg: pair.angleDiffDeg,
        viewSeparationRad: pair.viewSeparationRad,
        depthVisible: front.viewDepth,
        depthHidden: hidden.viewDepth,
        tieBreak
      }
    });
    hiddenByMap.set(hiddenId, frontId);
    const list = occludesMap.get(frontId) ?? [];
    list.push(hiddenId);
    occludesMap.set(frontId, list);
  }

  const visibilities: BodyVisibility[] = positions
    .map((p) => {
      const hiddenBy = hiddenByMap.get(p.id) ?? null;
      const occludes = (occludesMap.get(p.id) ?? []).slice().sort();
      const state: BodyVisibility['state'] = hiddenBy ? 'occluded' : occludes.length > 0 ? 'occluding' : 'visible';
      return { id: p.id, state, occludes, hiddenBy };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  return { relations, visibilities };
}
