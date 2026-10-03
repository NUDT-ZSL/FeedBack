import { Simulation } from './Simulation';
import type { Trajectory } from './types';

/** FNV-1a 32 位哈希，用于轨迹快速指纹比较 */
export function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashTrajectory(trajectory: Trajectory): string {
  return hashString(JSON.stringify(trajectory.steps));
}

export interface TrajectoryDiff {
  equal: boolean;
  firstDiffStep: number | null;
  message: string;
}

/** 逐步比较两条轨迹，返回第一个分歧发生的时间步（便于诊断） */
export function compareTrajectories(a: Trajectory, b: Trajectory): TrajectoryDiff {
  if (a.config.seed !== b.config.seed
    || a.config.width !== b.config.width
    || a.config.height !== b.config.height
    || a.config.initialFish !== b.config.initialFish) {
    return { equal: false, firstDiffStep: null, message: '初始配置不一致' };
  }
  if (a.steps.length !== b.steps.length) {
    return { equal: false, firstDiffStep: null, message: `轨迹长度不一致: ${a.steps.length} vs ${b.steps.length}` };
  }
  for (let i = 0; i < a.steps.length; i++) {
    const sa = JSON.stringify(a.steps[i]);
    const sb = JSON.stringify(b.steps[i]);
    if (sa !== sb) {
      return { equal: false, firstDiffStep: a.steps[i].step, message: `时间步 ${a.steps[i].step} 的状态不一致` };
    }
  }
  return { equal: true, firstDiffStep: null, message: '轨迹完全一致' };
}

/**
 * 离线回放：根据轨迹中的配置与输入序列重新运行模拟，不依赖真实鼠标事件或网络。
 * 返回重新生成的轨迹，可与原轨迹逐位比较。
 */
export function replayTrajectory(trajectory: Trajectory): Trajectory {
  const sim = new Simulation(trajectory.config, { record: true });
  const maxStep = trajectory.steps.length > 0 ? trajectory.steps[trajectory.steps.length - 1].step + 1 : 0;
  for (const input of trajectory.inputs) {
    sim.queueInput(input.event, input.step);
  }
  sim.run(Math.max(trajectory.steps.length, maxStep));
  return sim.getTrajectory();
}

/** 回放并直接比对，返回指纹与差异信息 */
export function verifyTrajectory(trajectory: Trajectory): {
  replayHash: string;
  originalHash: string;
  diff: TrajectoryDiff;
} {
  const replayed = replayTrajectory(trajectory);
  return {
    replayHash: hashTrajectory(replayed),
    originalHash: hashTrajectory(trajectory),
    diff: compareTrajectories(trajectory, replayed)
  };
}

/** 序列化为可存储/传输的 JSON 字符串 */
export function serializeTrajectory(trajectory: Trajectory): string {
  return JSON.stringify(trajectory);
}

export function deserializeTrajectory(text: string): Trajectory {
  const parsed = JSON.parse(text) as Trajectory;
  if (!parsed || parsed.version !== 1 || !parsed.config || !Array.isArray(parsed.steps)) {
    throw new Error('无效的轨迹数据');
  }
  return parsed;
}
