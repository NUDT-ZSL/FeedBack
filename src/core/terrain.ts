import type { RandomSource } from './random';

/** 地形上的草药落点（纯数据，不依赖 THREE/DOM）。 */
export interface HerbPosition {
  x: number;
  y: number;
  z: number;
}

export const HERB_COUNT = 25;
export const HERB_MAX_PLACEMENT_ATTEMPTS = 50;
export const HERB_STREAM_MIN_DISTANCE = 3;
export const HERB_CENTER_RATIO = 0.4;
export const HERB_MAX_HEIGHT = 5;
/** 同一格落点之间允许的最小间距，用于兜底扫描时避免位置重叠。 */
export const HERB_MIN_SEPARATION = 0.5;

/**
 * 程序化地形高度函数，与 TerrainGenerator 使用的公式完全一致。
 * 纯函数：相同 (x, z, size) 永远返回相同高度。
 */
export function getTerrainHeight(x: number, z: number, size: number): number {
  let height = 0;
  height += Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2;
  height += Math.sin(x * 0.02 + 1) * Math.cos(z * 0.03) * 3;
  height += Math.sin(x * 0.1) * 0.5;

  const distFromCenter = Math.sqrt(x * x + z * z);
  if (distFromCenter > size * 0.35) {
    height += (distFromCenter - size * 0.35) * 0.15;
  }

  return height;
}

/** 溪流中心线在给定 x 处的 z 坐标。 */
export function getStreamCenterZ(x: number): number {
  return Math.sin(((x + 30) / 60) * Math.PI * 1.5) * 8;
}

/**
 * 草药落点约束：远离溪流（>3）、位于中心区域（<size*0.4）、高度受限（<5）。
 */
export function isValidHerbPosition(x: number, z: number, size: number): boolean {
  const height = getTerrainHeight(x, z, size);
  const distFromStream = Math.abs(z - getStreamCenterZ(x));
  const distFromCenter = Math.sqrt(x * x + z * z);

  return (
    distFromStream > HERB_STREAM_MIN_DISTANCE &&
    distFromCenter < size * HERB_CENTER_RATIO &&
    height < HERB_MAX_HEIGHT
  );
}

/**
 * 生成 count 个草药落点。
 *
 * 先用注入的随机源采样；单个落点在 HERB_MAX_PLACEMENT_ATTEMPTS 次内
 * 若始终被边界条件拒绝，则进入确定性的网格兜底扫描，保证不会静默跳过：
 * 最终返回的位置数量要么恰好为 count（且全部满足约束），
 * 要么在整个中心区域都不存在合法位置时抛出明确错误。
 */
export function generateHerbPositions(
  count: number,
  size: number,
  random: RandomSource,
  options: { isValid?: (x: number, z: number, size: number) => boolean } = {}
): HerbPosition[] {
  const isValid = options.isValid ?? ((x: number, z: number) => isValidHerbPosition(x, z, size));
  const positions: HerbPosition[] = [];

  const toPosition = (x: number, z: number): HerbPosition => ({
    x,
    y: getTerrainHeight(x, z, size) + 0.05,
    z
  });

  const isFarFromExisting = (x: number, z: number): boolean =>
    positions.every(p => Math.hypot(p.x - x, p.z - z) >= HERB_MIN_SEPARATION);

  const randomSample = (): { x: number; z: number } => ({
    x: (random() - 0.5) * (size - 20),
    z: (random() - 0.5) * (size - 20)
  });

  for (let i = 0; i < count; i++) {
    let accepted: { x: number; z: number } | null = null;

    for (let attempt = 0; attempt < HERB_MAX_PLACEMENT_ATTEMPTS; attempt++) {
      const candidate = randomSample();
      if (isValid(candidate.x, candidate.z, size) && isFarFromExisting(candidate.x, candidate.z)) {
        accepted = candidate;
        break;
      }
    }

    if (!accepted) {
      accepted = scanValidPosition(size, (x, z) => isValid(x, z, size), isFarFromExisting);
    }

    if (!accepted) {
      throw new Error(
        `无法为第 ${i + 1}/${count} 株草药找到满足约束的落点 ` +
          `（溪流距离>${HERB_STREAM_MIN_DISTANCE}、中心半径<${size * HERB_CENTER_RATIO}、高度<${HERB_MAX_HEIGHT}）`
      );
    }

    positions.push(toPosition(accepted.x, accepted.z));
  }

  return positions;
}

/**
 * 确定性兜底扫描：在中心区域内按固定网格枚举候选点，
 * 返回第一个满足约束且不与已有落点重叠的位置；无则返回 null。
 */
function scanValidPosition(
  size: number,
  isValid: (x: number, z: number, size: number) => boolean,
  isFarFromExisting: (x: number, z: number) => boolean
): { x: number; z: number } | null {
  const bound = size * HERB_CENTER_RATIO;
  const step = 0.5;

  for (let x = -bound; x <= bound + 1e-9; x += step) {
    for (let z = -bound; z <= bound + 1e-9; z += step) {
      if (Math.hypot(x, z) > bound) continue;
      if (!isFarFromExisting(x, z)) continue;
      if (isValid(x, z, size)) return { x, z };
    }
  }

  return null;
}
