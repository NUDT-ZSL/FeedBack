/**
 * 陶器碎片拼合核心逻辑（纯函数 + 会话推进器，无任何渲染/DOM 依赖）。
 *
 * 职责边界：
 * - 碎片几何判定：checkSnapCondition / checkCollision
 * - 集合结构校验：validateFragmentSet（依赖成环、指向缺失等）
 * - 进度推进与完成态结算：createPuzzleSession
 * - 进度与完成态相互印证：checkSnapshotConsistency
 *
 * 数据流向：交互层/批量入口 -> PuzzleOperation -> 会话 -> PuzzleEvent /
 * SessionSnapshot -> 渲染层或离线验证器。
 */

import type {
  DistortionFinding,
  PuzzleEvent,
  PuzzleOperation,
  RejectionReason,
  SessionSnapshot,
  SnapConditionResult,
  FragmentSpec,
  Vec3,
} from './types.ts';

/** 吸附距离阈值（单位）。 */
export const SNAP_DISTANCE_THRESHOLD = 1.5;
/** 吸附角度阈值（弧度，即 10°）。 */
export const SNAP_ANGLE_THRESHOLD = (10 * Math.PI) / 180;
/** 碎片间碰撞距离阈值（单位）。 */
export const COLLISION_DISTANCE_THRESHOLD = 0.3;

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

/** 两组欧拉角之间的最大单轴角差（弧度，范围 [0, π]）。 */
export function angleDifference(a: Vec3, b: Vec3): number {
  return Math.max(
    Math.abs(wrapAngle(a.x - b.x)),
    Math.abs(wrapAngle(a.y - b.y)),
    Math.abs(wrapAngle(a.z - b.z)),
  );
}

/** 判定某个位姿是否满足吸附条件，并返回可观察的距离/角度偏差。 */
export function checkSnapCondition(
  position: Vec3,
  targetPosition: Vec3,
  rotation: Vec3,
  targetRotation: Vec3,
): SnapConditionResult {
  const dist = distance(position, targetPosition);
  const angleDiff = angleDifference(rotation, targetRotation);
  return {
    shouldSnap: dist < SNAP_DISTANCE_THRESHOLD && angleDiff < SNAP_ANGLE_THRESHOLD,
    distance: dist,
    angleDiff,
  };
}

/** 判定两个未拼合碎片是否发生碰撞。 */
export function checkCollision(
  aPosition: Vec3,
  aPlaced: boolean,
  bPosition: Vec3,
  bPlaced: boolean,
): boolean {
  if (aPlaced || bPlaced) return false;
  return distance(aPosition, bPosition) < COLLISION_DISTANCE_THRESHOLD;
}

/**
 * 校验碎片集合的结构性失真：空集合、id 重复、依赖指向缺失、依赖成环。
 * 返回空数组表示集合结构健康。
 */
export function validateFragmentSet(specs: FragmentSpec[]): DistortionFinding[] {
  const findings: DistortionFinding[] = [];
  if (specs.length === 0) {
    findings.push({
      reason: 'empty-fragment-set',
      detail: '碎片集合为空，无法形成有效拼合结论',
    });
    return findings;
  }

  const ids = new Set<string>();
  for (const spec of specs) {
    if (ids.has(spec.id)) {
      findings.push({
        reason: 'duplicate-fragment-id',
        fragmentId: spec.id,
        detail: `碎片 id "${spec.id}" 在集合中重复定义`,
      });
    }
    ids.add(spec.id);
  }

  for (const spec of specs) {
    for (const dep of spec.dependsOn) {
      if (!ids.has(dep)) {
        findings.push({
          reason: 'missing-dependency',
          fragmentId: spec.id,
          detail: `碎片 "${spec.id}" 依赖的碎片 "${dep}" 不存在于集合中`,
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const reportedCycles = new Set<string>();

  const walk = (id: string, path: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      const key = [...cycle].sort().join('->');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        findings.push({
          reason: 'dependency-cycle',
          fragmentId: id,
          detail: `拼合依赖成环: ${cycle.join(' -> ')}`,
        });
      }
      return;
    }
    visiting.add(id);
    const spec = byId.get(id);
    if (spec) {
      for (const dep of spec.dependsOn) {
        if (byId.has(dep)) walk(dep, [...path, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const spec of specs) walk(spec.id, []);
  return findings;
}

export interface PuzzleSession {
  apply(operation: PuzzleOperation): PuzzleEvent[];
  snapshot(): SessionSnapshot;
}

/**
 * 创建一个拼合会话。会话是推进拼合状态的唯一入口：
 * 同一碎片集合无论经由交互拖拽（drag+submit）还是批量入口（place），
 * 走出的结论与进度轨迹都必须一致。
 */
export function createPuzzleSession(specs: FragmentSpec[]): PuzzleSession {
  const distortions = validateFragmentSet(specs);
  const distorted = distortions.length > 0;
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const placed = new Set<string>();
  const pendingPoses = new Map<string, { position: Vec3; rotation: Vec3 }>();
  const events: PuzzleEvent[] = [];
  const progressTrajectory: number[] = [];
  let completed = false;

  if (distorted) {
    events.push({ type: 'distorted', findings: distortions });
  }

  const reject = (
    fragmentId: string,
    reason: RejectionReason,
    detail: string,
    pendingDependencies: string[] = [],
  ): PuzzleEvent => ({
    type: 'rejected',
    fragmentId,
    reason,
    detail,
    pendingDependencies,
    placedCount: placed.size,
    total: specs.length,
  });

  const attemptSnap = (fragmentId: string): PuzzleEvent[] => {
    const emitted: PuzzleEvent[] = [];
    if (distorted) {
      emitted.push(reject(fragmentId, 'session-distorted', '碎片集合存在结构性失真，拼合结论不可信'));
      return emitted;
    }
    const spec = byId.get(fragmentId);
    if (!spec) {
      emitted.push(reject(fragmentId, 'unknown-fragment', `碎片 "${fragmentId}" 不在当前碎片集合中`));
      return emitted;
    }
    if (placed.has(fragmentId)) {
      emitted.push(
        reject(fragmentId, 'duplicate-placement', `碎片 "${fragmentId}" 已拼合，重复提交不会覆盖既有结果`),
      );
      return emitted;
    }
    const pose = pendingPoses.get(fragmentId);
    if (!pose) {
      emitted.push(reject(fragmentId, 'not-dragging', `碎片 "${fragmentId}" 尚未被拖拽到任何位姿`));
      return emitted;
    }
    const unmet = spec.dependsOn.filter((dep) => byId.has(dep) && !placed.has(dep));
    if (unmet.length > 0) {
      emitted.push(
        reject(
          fragmentId,
          'dependency-unmet',
          `碎片 "${fragmentId}" 的前置依赖尚未拼合: ${unmet.join(', ')}`,
          unmet,
        ),
      );
      return emitted;
    }
    const condition = checkSnapCondition(pose.position, spec.targetPosition, pose.rotation, spec.targetRotation);
    if (!condition.shouldSnap) {
      emitted.push(
        reject(
          fragmentId,
          'pose-out-of-tolerance',
          `位姿超出吸附阈值: 距离 ${condition.distance.toFixed(3)} / 角度 ${condition.angleDiff.toFixed(3)}`,
        ),
      );
      return emitted;
    }
    placed.add(fragmentId);
    pendingPoses.delete(fragmentId);
    progressTrajectory.push(placed.size);
    emitted.push({
      type: 'snapped',
      fragmentId,
      placedCount: placed.size,
      total: specs.length,
      distance: condition.distance,
      angleDiff: condition.angleDiff,
    });
    if (placed.size === specs.length && !completed) {
      completed = true;
      emitted.push({ type: 'completed', placedCount: placed.size, total: specs.length });
    }
    return emitted;
  };

  return {
    apply(operation: PuzzleOperation): PuzzleEvent[] {
      if (operation.type === 'drag') {
        if (byId.has(operation.fragmentId) && !placed.has(operation.fragmentId)) {
          pendingPoses.set(operation.fragmentId, {
            position: operation.position,
            rotation: operation.rotation,
          });
        }
        return [];
      }
      if (operation.type === 'submit') {
        const emitted = attemptSnap(operation.fragmentId);
        events.push(...emitted);
        return emitted;
      }
      if (byId.has(operation.fragmentId) && !placed.has(operation.fragmentId)) {
        pendingPoses.set(operation.fragmentId, {
          position: operation.position,
          rotation: operation.rotation,
        });
      }
      const emitted = attemptSnap(operation.fragmentId);
      events.push(...emitted);
      return emitted;
    },

    snapshot(): SessionSnapshot {
      return {
        status: distorted ? 'distorted' : completed ? 'completed' : 'in-progress',
        total: specs.length,
        placedCount: placed.size,
        placed: [...placed].sort(),
        progressTrajectory: [...progressTrajectory],
        events: [...events],
        distortions: distortions.map((finding) => ({ ...finding })),
      };
    },
  };
}

/**
 * 印证一份快照内部的一致性：进度轨迹、已拼合计数与完成态必须互相吻合。
 * 返回违规描述列表，空数组表示进度与完成态可以相互印证。
 */
export function checkSnapshotConsistency(snapshot: SessionSnapshot): string[] {
  const violations: string[] = [];

  if (snapshot.placedCount !== snapshot.placed.length) {
    violations.push(
      `进度计数失真: placedCount=${snapshot.placedCount} 与已拼合列表长度 ${snapshot.placed.length} 不一致`,
    );
  }
  if (new Set(snapshot.placed).size !== snapshot.placed.length) {
    violations.push('已拼合列表存在重复碎片，疑似结果被静默覆盖');
  }
  if (snapshot.placedCount > snapshot.total) {
    violations.push(`进度越界: placedCount=${snapshot.placedCount} 超过碎片总数 ${snapshot.total}`);
  }

  snapshot.progressTrajectory.forEach((value, index) => {
    if (value !== index + 1) {
      violations.push(`进度轨迹断裂: 第 ${index + 1} 次拼合后计数为 ${value}，应为 ${index + 1}`);
    }
  });
  const lastTrajectory = snapshot.progressTrajectory[snapshot.progressTrajectory.length - 1] ?? 0;
  if (lastTrajectory !== snapshot.placedCount) {
    violations.push(
      `进度轨迹与计数矛盾: 轨迹终点 ${lastTrajectory} 与 placedCount=${snapshot.placedCount} 不一致`,
    );
  }

  const snappedEvents = snapshot.events.filter((event) => event.type === 'snapped');
  if (snappedEvents.length !== snapshot.placedCount) {
    violations.push(
      `事件流失真: snapped 事件 ${snappedEvents.length} 次，但 placedCount=${snapshot.placedCount}`,
    );
  }
  const completedEvents = snapshot.events.filter((event) => event.type === 'completed');
  if (completedEvents.length > 1) {
    violations.push(`完成态被重复结算: completed 事件出现 ${completedEvents.length} 次`);
  }

  if (snapshot.status === 'completed') {
    if (snapshot.placedCount !== snapshot.total || snapshot.total === 0) {
      violations.push(
        `完成态与进度矛盾: 状态为 completed，但进度为 ${snapshot.placedCount}/${snapshot.total}`,
      );
    }
    if (completedEvents.length !== 1) {
      violations.push('完成态与事件流矛盾: 状态为 completed，但缺少对应的 completed 事件');
    }
  }
  if (snapshot.status === 'in-progress' && snapshot.placedCount === snapshot.total && snapshot.total > 0) {
    violations.push('完成态缺失: 全部碎片已拼合，但状态仍为 in-progress');
  }
  if (snapshot.status === 'distorted' && snapshot.distortions.length === 0) {
    violations.push('失真状态缺少失真原因记录');
  }
  if (snapshot.status !== 'distorted' && snapshot.distortions.length > 0) {
    violations.push('存在失真记录但状态未标记为 distorted');
  }

  return violations;
}
