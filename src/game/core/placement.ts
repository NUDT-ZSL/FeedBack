import { RandomSource } from './random';

export interface PlacementConfig {
  /** 地形边长（与 TerrainGenerator 的 size 一致） */
  size: number;
  /** 需要放置的草药数量 */
  count: number;
  /** 采样时避开边界的内缩距离 */
  edgeMargin: number;
  /** 距溪流的最小水平距离 */
  minStreamDistance: number;
  /** 距场景中心的最大距离（必须位于中心区域） */
  maxCenterDistance: number;
  /** 地形高度上限 */
  maxHeight: number;
  /** 拒绝采样的最大随机尝试次数（次数耗尽后切换为确定性兜底搜索） */
  randomAttempts: number;
  /** 草药相对地表的抬升高度 */
  groundOffset: number;
}

export const DEFAULT_PLACEMENT_CONFIG: PlacementConfig = {
  size: 100,
  count: 25,
  edgeMargin: 10,
  minStreamDistance: 3,
  maxCenterDistance: 100 * 0.4,
  maxHeight: 5,
  randomAttempts: 50,
  groundOffset: 0.05
};

export interface PlacementPoint {
  x: number;
  y: number;
  z: number;
}

export interface PlacedHerbResult {
  points: PlacementPoint[];
  /** 每个草药经历的拒绝次数（用于验证拒绝采样确实发生过且未静默丢弃） */
  rejectionCounts: number[];
}

/**
 * 溪流中线：与 TerrainGenerator.createStream 中的曲线保持一致。
 * x 从 -30 到 30，z = sin((x+30)/60 * 1.5π) * 8。
 */
export function streamCenterZ(x: number): number {
  return Math.sin(((x + 30) / 60) * Math.PI * 1.5) * 8;
}

export function distanceFromStream(x: number, z: number): number {
  return Math.abs(z - streamCenterZ(x));
}

export function distanceFromCenter(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export interface PositionConstraintCheck {
  fromStream: number;
  fromCenter: number;
  height: number;
  valid: boolean;
  reasons: string[];
}

/** 单点约束校验，返回失败原因而不是静默返回布尔值 */
export function checkHerbPosition(
  x: number,
  z: number,
  height: number,
  config: PlacementConfig
): PositionConstraintCheck {
  const reasons: string[] = [];
  const fromStream = distanceFromStream(x, z);
  const fromCenter = distanceFromCenter(x, z);

  if (fromStream <= config.minStreamDistance) {
    reasons.push(`距溪流 ${fromStream.toFixed(3)} <= ${config.minStreamDistance}`);
  }
  if (fromCenter >= config.maxCenterDistance) {
    reasons.push(`距中心 ${fromCenter.toFixed(3)} >= ${config.maxCenterDistance}`);
  }
  if (height >= config.maxHeight) {
    reasons.push(`高度 ${height.toFixed(3)} >= ${config.maxHeight}`);
  }

  return { fromStream, fromCenter, height, valid: reasons.length === 0, reasons };
}

/**
 * 确定性草药布点。
 *
 * 关键保证：
 * 1. 返回点数严格等于 config.count —— 边界条件拒绝采样时绝不静默跳过导致缺数；
 * 2. 随机尝试耗尽后使用确定性的网格兜底搜索，仍然失败则抛出带诊断信息的错误；
 * 3. 相同种子 + 相同高度函数 + 相同配置 => 完全一致的结果。
 */
export function generateHerbPlacements(
  random: RandomSource,
  heightAt: (x: number, z: number) => number,
  config: PlacementConfig
): PlacedHerbResult {
  const points: PlacementPoint[] = [];
  const rejectionCounts: number[] = [];
  const span = config.size - config.edgeMargin * 2;

  for (let i = 0; i < config.count; i++) {
    let x = 0;
    let z = 0;
    let height = 0;
    let found = false;
    let rejections = 0;

    for (let attempt = 0; attempt < config.randomAttempts; attempt++) {
      x = (random.next() - 0.5) * span;
      z = (random.next() - 0.5) * span;
      height = heightAt(x, z);
      const check = checkHerbPosition(x, z, height, config);
      if (check.valid) {
        found = true;
        break;
      }
      rejections++;
    }

    if (!found) {
      const fallback = deterministicFallbackSearch(i, heightAt, config);
      if (!fallback) {
        throw new Error(
          `草药布点失败：第 ${i + 1}/${config.count} 株在 ${config.randomAttempts} 次随机尝试 ` +
          `与确定性网格兜底搜索后仍找不到满足约束（距溪流>${config.minStreamDistance}、` +
          `距中心<${config.maxCenterDistance}、高度<${config.maxHeight}）的位置`
        );
      }
      x = fallback.x;
      z = fallback.z;
      height = heightAt(x, z);
      found = true;
    }

    points.push({ x, y: height + config.groundOffset, z });
    rejectionCounts.push(rejections);
  }

  return { points, rejectionCounts };
}

/**
 * 兜底搜索：从中心螺旋向外的确定性网格扫描，
 * 不依赖随机数；被拒绝的候选也不静默丢弃，全部约束不满足时返回 null（由调用方报错）。
 */
function deterministicFallbackSearch(
  herbIndex: number,
  heightAt: (x: number, z: number) => number,
  config: PlacementConfig
): PlacementPoint | null {
  const half = (config.size - config.edgeMargin * 2) / 2;
  const rings = 20;
  // herbIndex 作为起始角偏移，保证不同草药兜底落点也互不相同且可复现
  const angleOffset = (herbIndex / config.count) * Math.PI * 2;

  for (let ring = 1; ring <= rings; ring++) {
    const radius = (ring / rings) * config.maxCenterDistance * 0.95;
    for (let a = 0; a < 16; a++) {
      const angle = angleOffset + (a / 16) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const height = heightAt(x, z);
      if (checkHerbPosition(x, z, height, config).valid) {
        return { x, y: height + config.groundOffset, z };
      }
    }
  }
  return null;
}
