// 停留段/移动段划分。
//
// 确定性契约：
// 1) 纯函数，同一组点 + 同一组参数在任意时刻输出完全一致（无随机性、无外部依赖）。
// 2) 异常不静默：坐标缺失/时间戳非法/时间倒序的点记录 error 级 issue 并排除出分段；
//    落在抖动带内的点记录 warning 级 issue 但仍保留在停留段中。
// 3) 有效点严格按输入顺序做从左到右的贪心扫描，因此对前缀的判定是因果的——
//    这使得窗口化增量重推与全量重推在数学上等价（见 engine.ts）。

import type {
  PositionPoint,
  SegmentationParams,
  SegmentationResult,
  Segment,
  ValidationIssue,
} from './types.ts';

const EARTH_RADIUS_METERS = 6_371_000;

/** Haversine 距离（米），不依赖任何 GIS 服务 */
export function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

// 双种子 FNV-1a，拼成 64 位十六进制内容指纹。纯 JS 实现，浏览器/Node 均可运行。
function fnv1a(str: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function contentHash(value: string): string {
  return (
    fnv1a(value, 0x811c9dc5).toString(16).padStart(8, '0') +
    fnv1a(value, 0x01000193).toString(16).padStart(8, '0')
  );
}

function buildSegment(
  targetId: string,
  kind: Segment['kind'],
  points: PositionPoint[],
): Segment {
  const first = points[0];
  const last = points[points.length - 1];
  const fingerprint = contentHash(
    JSON.stringify([
      kind,
      points.map((p) => [p.id, p.timestamp, p.lng, p.lat]),
    ]),
  );
  return {
    id: `seg:${targetId}:${kind}:${first.id}:${last.id}:${points.length}:${fingerprint}`,
    targetId,
    kind,
    startMs: first.timestamp,
    endMs: last.timestamp,
    pointIds: points.map((p) => p.id),
    anchor:
      kind === 'stay'
        ? { lng: first.lng as number, lat: first.lat as number }
        : null,
  };
}

/**
 * 异常校验，按输入顺序输出：
 * - missing-coordinates / invalid-timestamp：坐标或时间戳非法 → error，排除。
 * - out-of-order：时间戳早于此前已接受点的最大时间戳（running max）→ error，排除。
 *   因此返回的有效点子序列时间戳单调不减，可直接按时间窗口切片。
 */
export function validatePoints(points: PositionPoint[]): {
  valid: PositionPoint[];
  issues: ValidationIssue[];
} {
  const valid: PositionPoint[] = [];
  const issues: ValidationIssue[] = [];
  let maxTimestamp = -Infinity;

  for (const point of points) {
    const coordsFinite =
      Number.isFinite(point.lng) && Number.isFinite(point.lat);
    if (!coordsFinite) {
      issues.push({
        kind: 'missing-coordinates',
        severity: 'error',
        targetId: point.targetId,
        pointId: point.id,
        message: `point "${point.id}" of target "${point.targetId}" has missing/invalid coordinates; excluded from segmentation`,
      });
      continue;
    }
    if (!Number.isFinite(point.timestamp)) {
      issues.push({
        kind: 'invalid-timestamp',
        severity: 'error',
        targetId: point.targetId,
        pointId: point.id,
        message: `point "${point.id}" of target "${point.targetId}" has an invalid timestamp; excluded from segmentation`,
      });
      continue;
    }
    if (point.timestamp < maxTimestamp) {
      issues.push({
        kind: 'out-of-order',
        severity: 'error',
        targetId: point.targetId,
        pointId: point.id,
        message: `point "${point.id}" of target "${point.targetId}" is out of order: timestamp ${point.timestamp} < max accepted timestamp ${maxTimestamp}; excluded from segmentation`,
      });
      continue;
    }
    maxTimestamp = point.timestamp;
    valid.push(point);
  }

  return { valid, issues };
}

/**
 * 对“已通过校验、时间单调不减”的点做贪心分段：
 * - 以当前点为锚点向后吸收距离 <= stayRadiusMeters 的点，构成候选停留聚类；
 * - 聚类持续时长 >= minStayDurationMs 且点数 >= 2 → 停留段（锚点 = 聚类首点）；
 * - 否则聚类中的点并入当前移动段；移动点连续累积，在停留段形成时闭合。
 * - 点到锚点距离落在 (jitterRadiusMeters, stayRadiusMeters] 内时记录 jitter warning。
 */
export function segmentValidPoints(
  valid: PositionPoint[],
  params: SegmentationParams,
  targetId: string,
): { segments: Segment[]; issues: ValidationIssue[] } {
  const segments: Segment[] = [];
  const issues: ValidationIssue[] = [];
  let moveRun: PositionPoint[] = [];

  const flushMove = (): void => {
    if (moveRun.length > 0) {
      segments.push(buildSegment(targetId, 'move', moveRun));
      moveRun = [];
    }
  };

  let i = 0;
  while (i < valid.length) {
    const anchor = valid[i];
    const cluster: PositionPoint[] = [anchor];
    let j = i + 1;

    while (j < valid.length) {
      const distance = haversineMeters(
        anchor.lng as number,
        anchor.lat as number,
        valid[j].lng as number,
        valid[j].lat as number,
      );
      if (distance <= params.stayRadiusMeters) {
        if (distance > params.jitterRadiusMeters) {
          issues.push({
            kind: 'jitter',
            severity: 'warning',
            targetId,
            pointId: valid[j].id,
            message: `point "${valid[j].id}" deviates ${distance.toFixed(2)}m from stay anchor (jitter band (${params.jitterRadiusMeters}, ${params.stayRadiusMeters}]m); kept in stay segment`,
          });
        }
        cluster.push(valid[j]);
        j++;
      } else {
        break;
      }
    }

    const durationMs = cluster[cluster.length - 1].timestamp - cluster[0].timestamp;
    if (cluster.length >= 2 && durationMs >= params.minStayDurationMs) {
      flushMove();
      segments.push(buildSegment(targetId, 'stay', cluster));
    } else {
      moveRun.push(...cluster);
    }
    i = j;
  }

  flushMove();
  return { segments, issues };
}

/** 全量分段入口：校验 + 分段，异常记录与分段结果一并返回 */
export function segmentTrajectory(
  points: PositionPoint[],
  params: SegmentationParams,
  targetId?: string,
): SegmentationResult {
  const tid = targetId ?? points[0]?.targetId ?? 'unknown';
  const { valid, issues: validationIssues } = validatePoints(points);
  const { segments, issues: jitterIssues } = segmentValidPoints(
    valid,
    params,
    tid,
  );
  return {
    targetId: tid,
    segments,
    issues: [...validationIssues, ...jitterIssues],
  };
}
