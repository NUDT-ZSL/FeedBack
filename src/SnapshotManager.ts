/**
 * SnapshotManager.ts —— 参数快照纯逻辑模块
 *
 * 职责：
 *  - 定义快照数据结构与默认/基准参数
 *  - 快照创建、参数一致性比较（偏离检测）
 *  - 质量数组归一化（按摆锤数量截断/补齐）
 *  - 快照文件的序列化、导入解析与严格校验
 *  - localStorage 本地持久化（不依赖网络）
 *
 * 调用方：App.tsx（状态与事件）、SnapshotPanel.tsx（列表与导入导出按钮）。
 */

export interface SnapshotParams {
  ballCount: number;
  masses: number[];
  damping: number;
}

export interface Snapshot extends SnapshotParams {
  id: string;
  name: string;
  isBaseline: boolean;
  createdAt: number;
}

export const MIN_BALL_COUNT = 3;
export const MAX_BALL_COUNT = 10;
export const DEFAULT_BALL_COUNT = 5;
export const DEFAULT_MASS = 1;
export const MIN_MASS = 0.5;
export const MAX_MASS = 5;
export const MIN_DAMPING = 0;
export const MAX_DAMPING = 0.05;
export const DEFAULT_DAMPING = 0.005;

export const BASELINE_SNAPSHOT_ID = 'baseline-default';
export const BASELINE_SNAPSHOT_NAME = '基准（默认参数）';

const SNAPSHOT_FILE_VERSION = 1;
const STORAGE_KEY = 'newtons-cradle-snapshots-v1';

export const DEFAULT_PARAMS: SnapshotParams = {
  ballCount: DEFAULT_BALL_COUNT,
  masses: Array(DEFAULT_BALL_COUNT).fill(DEFAULT_MASS),
  damping: DEFAULT_DAMPING,
};

/** 确定的默认回退参数（每次返回独立副本，避免外部修改污染源常量）。 */
export function createDefaultParams(): SnapshotParams {
  return {
    ballCount: DEFAULT_BALL_COUNT,
    masses: Array(DEFAULT_BALL_COUNT).fill(DEFAULT_MASS),
    damping: DEFAULT_DAMPING,
  };
}

export function createBaselineSnapshot(): Snapshot {
  return {
    id: BASELINE_SNAPSHOT_ID,
    name: BASELINE_SNAPSHOT_NAME,
    ballCount: DEFAULT_BALL_COUNT,
    masses: Array(DEFAULT_BALL_COUNT).fill(DEFAULT_MASS),
    damping: DEFAULT_DAMPING,
    isBaseline: true,
    createdAt: 0,
  };
}

export function createSnapshotId(): string {
  return `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 质量数组归一化的明确规则：
 *  1. 多于 ballCount 的质量项一律截断；
 *  2. 不足 ballCount 时，用 DEFAULT_MASS 补齐到对应长度；
 *  3. 非有限数值按 DEFAULT_MASS 处理，并夹到合法质量区间。
 * 调用后结果长度恒等于 count，杜绝质量数组长度与摆锤数量不一致。
 */
export function normalizeMasses(rawMasses: number[], count: number): number[] {
  const next: number[] = [];
  for (let i = 0; i < count; i++) {
    const raw = rawMasses[i];
    const value = typeof raw === 'number' && Number.isFinite(raw)
      ? clamp(raw, MIN_MASS, MAX_MASS)
      : DEFAULT_MASS;
    next.push(value);
  }
  return next;
}

export function clampBallCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BALL_COUNT;
  return Math.min(MAX_BALL_COUNT, Math.max(MIN_BALL_COUNT, Math.round(n)));
}

export function clampDamping(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DAMPING;
  return clamp(n, MIN_DAMPING, MAX_DAMPING);
}

/** 用一组参数构造归一化后的快照（非基准）。 */
export function buildSnapshot(name: string, params: SnapshotParams): Snapshot {
  const ballCount = clampBallCount(params.ballCount);
  return {
    id: createSnapshotId(),
    name: name.trim() || '未命名快照',
    ballCount,
    masses: normalizeMasses(params.masses, ballCount),
    damping: clampDamping(params.damping),
    isBaseline: false,
    createdAt: Date.now(),
  };
}

/** 比较两组参数是否一致（比较前先归一化，用于偏离检测）。 */
export function paramsEqual(a: SnapshotParams, b: SnapshotParams): boolean {
  const aCount = clampBallCount(a.ballCount);
  const bCount = clampBallCount(b.ballCount);
  if (aCount !== bCount) return false;
  if (Math.abs(clampDamping(a.damping) - clampDamping(b.damping)) > 1e-9) return false;
  const aMasses = normalizeMasses(a.masses, aCount);
  const bMasses = normalizeMasses(b.masses, bCount);
  for (let i = 0; i < aCount; i++) {
    if (Math.abs(aMasses[i] - bMasses[i]) > 1e-9) return false;
  }
  return true;
}

export interface ImportResult {
  snapshots: Snapshot[];
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析并严格校验快照文件文本。
 *  - JSON 损坏 / 缺少 snapshots 数组：返回空列表 + 错误提示；
 *  - 单条快照字段缺失或非法：跳过该条并记录错误，不影响其他合法条目；
 *  - 质量数量与摆锤数量不一致：按 normalizeMasses 规则截断/补齐，并给出警告。
 * 该函数不修改任何已有数据，合并由调用方负责。
 */
export function parseSnapshotFile(text: string): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const snapshots: Snapshot[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      snapshots: [],
      errors: ['文件不是有效的 JSON（可能已损坏），未导入任何快照。'],
      warnings,
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.snapshots)) {
    return {
      snapshots: [],
      errors: ['文件格式不正确：缺少 snapshots 数组字段，未导入任何快照。'],
      warnings,
    };
  }

  const list = parsed.snapshots as unknown[];
  list.forEach((entry, index) => {
    const label = `第 ${index + 1} 条快照`;
    if (!isRecord(entry)) {
      errors.push(`${label}：不是有效对象，已跳过。`);
      return;
    }

    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      errors.push(`${label}：缺少有效的 name 字段，已跳过。`);
      return;
    }

    if (
      typeof entry.ballCount !== 'number' ||
      !Number.isInteger(entry.ballCount) ||
      entry.ballCount < MIN_BALL_COUNT ||
      entry.ballCount > MAX_BALL_COUNT
    ) {
      errors.push(
        `${label}「${name}」：ballCount 缺失或不在 ${MIN_BALL_COUNT}-${MAX_BALL_COUNT} 范围内，已跳过。`
      );
      return;
    }

    if (
      typeof entry.damping !== 'number' ||
      !Number.isFinite(entry.damping) ||
      entry.damping < MIN_DAMPING ||
      entry.damping > MAX_DAMPING
    ) {
      errors.push(
        `${label}「${name}」：damping 缺失或不在 ${MIN_DAMPING.toFixed(2)}-${MAX_DAMPING.toFixed(2)} 范围内，已跳过。`
      );
      return;
    }

    if (
      !Array.isArray(entry.masses) ||
      entry.masses.some(
        (m) =>
          typeof m !== 'number' ||
          !Number.isFinite(m) ||
          m < MIN_MASS ||
          m > MAX_MASS
      )
    ) {
      errors.push(
        `${label}「${name}」：masses 缺失或包含非法质量值（每项须为 ${MIN_MASS}-${MAX_MASS} 的数字），已跳过。`
      );
      return;
    }

    const rawMasses = entry.masses as number[];
    if (rawMasses.length !== entry.ballCount) {
      warnings.push(
        `${label}「${name}」：质量项数量(${rawMasses.length})与摆锤数量(${entry.ballCount})不一致，已按规则截断/补齐。`
      );
    }

    snapshots.push({
      id: createSnapshotId(),
      name,
      ballCount: entry.ballCount,
      masses: normalizeMasses(rawMasses, entry.ballCount),
      damping: entry.damping,
      isBaseline: false,
      createdAt: Date.now(),
    });
  });

  if (list.length === 0) {
    warnings.push('文件中没有任何快照记录。');
  }

  return { snapshots, errors, warnings };
}

/** 把快照列表序列化成可离线保存的 JSON 文本（基准快照不导出）。 */
export function serializeSnapshots(snapshots: Snapshot[]): string {
  const payload = {
    version: SNAPSHOT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    snapshots: snapshots
      .filter((s) => !s.isBaseline)
      .map((s) => ({
        name: s.name,
        ballCount: s.ballCount,
        masses: s.masses,
        damping: s.damping,
      })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 从 localStorage 载入快照。
 * 始终保证基准快照存在且内容为确定的默认参数；本地数据损坏时仅丢弃存储内容。
 */
export function loadSnapshots(): Snapshot[] {
  const baseline = createBaselineSnapshot();
  if (typeof localStorage === 'undefined') return [baseline];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [baseline];
    const result = parseSnapshotFile(raw);
    return [baseline, ...result.snapshots];
  } catch {
    return [baseline];
  }
}

export function saveSnapshots(snapshots: Snapshot[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const userSnapshots = snapshots.filter((s) => !s.isBaseline);
    localStorage.setItem(STORAGE_KEY, serializeSnapshots(userSnapshots));
  } catch {
    // 存储失败（隐私模式/配额）不影响内存中的快照功能。
  }
}
