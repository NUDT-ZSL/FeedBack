// 参数快照的纯逻辑模块：类型定义、默认值、归一化规则、导入校验与导出序列化。
// 被 App.tsx（状态管理）和 SnapshotPanel.tsx（界面展示）共同使用，不依赖任何 DOM/网络 API。

export const DEFAULT_BALL_COUNT = 5;
export const DEFAULT_MASS = 1;
export const DEFAULT_DAMPING = 0.005;

export const MIN_BALL_COUNT = 3;
export const MAX_BALL_COUNT = 10;
export const MIN_MASS = 0.5;
export const MAX_MASS = 5;
export const MIN_DAMPING = 0;
export const MAX_DAMPING = 0.05;

export const BASELINE_SNAPSHOT_ID = 'baseline';
export const SNAPSHOT_FILE_VERSION = 1;

export interface SnapshotParams {
  ballCount: number;
  masses: number[];
  damping: number;
}

export interface Snapshot extends SnapshotParams {
  id: string;
  name: string;
  createdAt: number;
  isBaseline?: boolean;
}

export interface ImportedSnapshot {
  name: string;
  params: SnapshotParams;
}

export interface ImportResult {
  imported: ImportedSnapshot[];
  errors: string[];
}

export const DEFAULT_PARAMS: SnapshotParams = {
  ballCount: DEFAULT_BALL_COUNT,
  masses: Array(DEFAULT_BALL_COUNT).fill(DEFAULT_MASS),
  damping: DEFAULT_DAMPING,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// 质量数组归一化规则：长度大于摆锤数量时截断多余项，不足时用默认质量 1kg 补齐，
// 保证 masses.length 始终等于 ballCount。
export function normalizeMasses(masses: number[], ballCount: number): number[] {
  const next = masses
    .slice(0, ballCount)
    .map((m) => clamp(typeof m === 'number' && Number.isFinite(m) ? m : DEFAULT_MASS, MIN_MASS, MAX_MASS));
  while (next.length < ballCount) next.push(DEFAULT_MASS);
  return next;
}

// 将任意来源的参数收敛到合法范围，并套用质量数组归一化规则。
export function normalizeParams(params: SnapshotParams): SnapshotParams {
  const ballCount = clamp(
    Math.round(typeof params.ballCount === 'number' && Number.isFinite(params.ballCount)
      ? params.ballCount
      : DEFAULT_BALL_COUNT),
    MIN_BALL_COUNT,
    MAX_BALL_COUNT
  );
  return {
    ballCount,
    masses: normalizeMasses(Array.isArray(params.masses) ? params.masses : [], ballCount),
    damping: clamp(
      typeof params.damping === 'number' && Number.isFinite(params.damping)
        ? params.damping
        : DEFAULT_DAMPING,
      MIN_DAMPING,
      MAX_DAMPING
    ),
  };
}

export function paramsEqual(a: SnapshotParams, b: SnapshotParams): boolean {
  const na = normalizeParams(a);
  const nb = normalizeParams(b);
  return (
    na.ballCount === nb.ballCount &&
    na.damping === nb.damping &&
    na.masses.length === nb.masses.length &&
    na.masses.every((m, i) => m === nb.masses[i])
  );
}

let idCounter = 0;
export function generateSnapshotId(): string {
  idCounter += 1;
  return `snap_${Date.now().toString(36)}_${idCounter}`;
}

export function createBaselineSnapshot(): Snapshot {
  return {
    id: BASELINE_SNAPSHOT_ID,
    name: '基准快照',
    createdAt: 0,
    isBaseline: true,
    ...normalizeParams(DEFAULT_PARAMS),
  };
}

export function createSnapshot(name: string, params: SnapshotParams): Snapshot {
  return {
    id: generateSnapshotId(),
    name,
    createdAt: Date.now(),
    ...normalizeParams(params),
  };
}

// 生成不重复的显示名：重名时追加 " (2)"、" (3)"……
export function dedupeName(name: string, existingNames: string[]): string {
  if (!existingNames.includes(name)) return name;
  let i = 2;
  while (existingNames.includes(`${name} (${i})`)) i += 1;
  return `${name} (${i})`;
}

export interface SnapshotFileFormat {
  version: number;
  exportedAt: string;
  snapshots: Snapshot[];
}

export function serializeSnapshots(snapshots: Snapshot[]): string {
  const payload: SnapshotFileFormat = {
    version: SNAPSHOT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    snapshots,
  };
  return JSON.stringify(payload, null, 2);
}

function validateEntry(entry: unknown, index: number): { ok: true; value: ImportedSnapshot } | { ok: false; error: string } {
  const label = `第 ${index + 1} 条快照`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { ok: false, error: `${label}：条目不是有效的对象` };
  }
  const raw = entry as Record<string, unknown>;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    return { ok: false, error: `${label}：缺少有效的 name 字段` };
  }
  if (typeof raw.ballCount !== 'number' || !Number.isFinite(raw.ballCount)) {
    return { ok: false, error: `${label}（${raw.name}）：缺少有效的 ballCount 字段` };
  }
  if (!Array.isArray(raw.masses) || raw.masses.some((m) => typeof m !== 'number' || !Number.isFinite(m))) {
    return { ok: false, error: `${label}（${raw.name}）：masses 字段缺失或包含非数字项` };
  }
  if (typeof raw.damping !== 'number' || !Number.isFinite(raw.damping)) {
    return { ok: false, error: `${label}（${raw.name}）：缺少有效的 damping 字段` };
  }
  const params = normalizeParams({
    ballCount: raw.ballCount,
    masses: raw.masses as number[],
    damping: raw.damping,
  });
  return { ok: true, value: { name: raw.name.trim(), params } };
}

// 解析并校验导入文件。支持 { version, snapshots: [...] } 或裸数组两种格式。
// 损坏的条目会被跳过并记录错误，不会抛出异常，也不会影响已有快照。
export function parseSnapshotFile(text: string): ImportResult {
  const errors: string[] = [];
  const imported: ImportedSnapshot[] = [];

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { imported, errors: ['文件不是有效的 JSON，未导入任何快照'] };
  }

  let entries: unknown[];
  if (Array.isArray(data)) {
    entries = data;
  } else if (typeof data === 'object' && data !== null && Array.isArray((data as SnapshotFileFormat).snapshots)) {
    entries = (data as SnapshotFileFormat).snapshots;
  } else {
    return { imported, errors: ['文件格式无法识别：应为快照数组或包含 snapshots 字段的对象'] };
  }

  if (entries.length === 0) {
    return { imported, errors: ['文件中没有可导入的快照'] };
  }

  entries.forEach((entry, index) => {
    const result = validateEntry(entry, index);
    if (result.ok) {
      imported.push(result.value);
    } else {
      errors.push(result.error);
    }
  });

  return { imported, errors };
}
