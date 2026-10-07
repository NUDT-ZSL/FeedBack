/**
 * 虚拟时间胶囊 —— 领域核心（纯函数状态机）
 *
 * 所有时间相关判断都由显式传入的 `now`（毫秒时间戳）驱动，
 * 本模块不读取系统时钟，因此边界时刻（恰好等于投递时间等）
 * 可以在测试中被精确、重复地复现。
 *
 * 状态机（严格单向，不允许回退）：
 *   sealed（已创建/锁定）
 *     -- now >= deliverAt --> delivered（已投递/可开启）
 *     -- 条件满足并解锁 --> unlocked（已解锁）
 */

export type CapsuleStatus = 'sealed' | 'delivered' | 'unlocked';

export type UnlockCondition =
  | { type: 'none' }
  | { type: 'after'; at: number }
  | { type: 'passphrase'; hash: string };

export interface Capsule {
  id: string;
  title: string;
  content: string;
  deliverAt: number;
  unlockCondition: UnlockCondition;
  status: CapsuleStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  deliveredAt: number | null;
  unlockedAt: number | null;
}

export type CapsuleErrorCode =
  | 'INVALID_INPUT'
  | 'DELIVER_AT_IN_PAST'
  | 'ALREADY_DELIVERED'
  | 'ALREADY_UNLOCKED'
  | 'NOT_DELIVERABLE_YET'
  | 'CONDITION_NOT_MET'
  | 'CLOCK_REGRESSION';

export interface CapsuleError {
  code: CapsuleErrorCode;
  message: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: CapsuleError };

export const STATUS_ORDER: Record<CapsuleStatus, number> = {
  sealed: 0,
  delivered: 1,
  unlocked: 2,
};

const STATUSES: ReadonlySet<CapsuleStatus> = new Set([
  'sealed',
  'delivered',
  'unlocked',
]);

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(code: CapsuleErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateCondition(raw: unknown): raw is UnlockCondition {
  if (typeof raw !== 'object' || raw === null) return false;
  const condition = raw as Record<string, unknown>;
  if (condition.type === 'none') return true;
  if (condition.type === 'after') return isFiniteNumber(condition.at);
  if (condition.type === 'passphrase') {
    return typeof condition.hash === 'string' && condition.hash.length > 0;
  }
  return false;
}

/**
 * 口令指纹：FNV-1a 64 位。纯函数、无外部依赖、离线可用。
 * 仅用于领域逻辑与测试中的口令比对，不用于生产级安全保证。
 */
export function hashPassphrase(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash = BigInt(byte) ^ hash;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export interface CreateCapsuleInput {
  id: string;
  title: string;
  content: string;
  deliverAt: number;
  unlockCondition?: UnlockCondition;
}

/** 创建胶囊（状态恒为 sealed，version 从 1 开始）。 */
export function createCapsule(
  input: CreateCapsuleInput,
  now: number,
): Result<Capsule> {
  if (
    typeof input.id !== 'string' ||
    input.id.length === 0 ||
    typeof input.title !== 'string' ||
    input.title.trim().length === 0 ||
    typeof input.content !== 'string' ||
    !isFiniteNumber(input.deliverAt) ||
    !isFiniteNumber(now)
  ) {
    return fail(
      'INVALID_INPUT',
      'id/title/content/deliverAt/now 缺失或类型不合法',
    );
  }
  if (input.deliverAt < now) {
    return fail(
      'DELIVER_AT_IN_PAST',
      `投递时间 ${input.deliverAt} 早于当前时间 ${now}`,
    );
  }
  const condition = input.unlockCondition ?? { type: 'none' } as const;
  if (!validateCondition(condition)) {
    return fail('INVALID_INPUT', '开启条件 unlockCondition 不合法');
  }
  return ok({
    id: input.id,
    title: input.title,
    content: input.content,
    deliverAt: input.deliverAt,
    unlockCondition: condition,
    status: 'sealed',
    version: 1,
    createdAt: now,
    updatedAt: now,
    deliveredAt: null,
    unlockedAt: null,
  });
}

export interface CapsulePatch {
  title?: string;
  content?: string;
  deliverAt?: number;
  unlockCondition?: UnlockCondition;
}

/**
 * 编辑胶囊。仅 sealed 状态可编辑；投递/解锁后任何编辑都被明确拒绝，
 * 保证内容不会被覆盖。createdAt 与状态时间戳永不改变。
 */
export function editCapsule(
  capsule: Capsule,
  patch: CapsulePatch,
  now: number,
): Result<Capsule> {
  if (capsule.status === 'unlocked') {
    return fail('ALREADY_UNLOCKED', '胶囊已解锁，内容不可再编辑');
  }
  if (capsule.status === 'delivered') {
    return fail('ALREADY_DELIVERED', '胶囊已投递，内容不可再编辑');
  }
  if (!isFiniteNumber(now) || now < capsule.updatedAt) {
    return fail(
      'CLOCK_REGRESSION',
      `当前时间 ${now} 早于上次更新时间 ${capsule.updatedAt}`,
    );
  }
  const next: Capsule = {
    ...capsule,
    ...structuredClone(patch),
  };
  if (
    (patch.title !== undefined &&
      (typeof next.title !== 'string' || next.title.trim().length === 0)) ||
    (patch.content !== undefined && typeof next.content !== 'string') ||
    (patch.deliverAt !== undefined && !isFiniteNumber(next.deliverAt)) ||
    (patch.unlockCondition !== undefined &&
      !validateCondition(next.unlockCondition))
  ) {
    return fail('INVALID_INPUT', '编辑字段类型不合法');
  }
  if (next.deliverAt < now) {
    return fail(
      'DELIVER_AT_IN_PAST',
      `投递时间 ${next.deliverAt} 早于当前时间 ${now}`,
    );
  }
  next.version = capsule.version + 1;
  next.updatedAt = now;
  return ok(next);
}

/**
 * 按时间推进状态。幂等：
 * - sealed 且 now < deliverAt：保持锁定；
 * - sealed 且 now >= deliverAt（含恰好相等）：转为 delivered，deliveredAt 只写一次；
 * - 已经 delivered/unlocked：无论 now 取何值都原样返回，状态绝不回退。
 */
export function evaluateCapsule(
  capsule: Capsule,
  now: number,
): Result<Capsule> {
  if (!isFiniteNumber(now)) {
    return fail('INVALID_INPUT', '当前时间 now 不合法');
  }
  if (capsule.status !== 'sealed') {
    return ok(capsule);
  }
  if (now < capsule.deliverAt) {
    return ok(capsule);
  }
  return ok({
    ...capsule,
    status: 'delivered',
    deliveredAt: now,
    updatedAt: Math.max(now, capsule.updatedAt),
    version: capsule.version + 1,
  });
}

export interface UnlockProof {
  passphrase?: string;
}

function checkCondition(
  condition: UnlockCondition,
  now: number,
  proof: UnlockProof | undefined,
): boolean {
  switch (condition.type) {
    case 'none':
      return true;
    case 'after':
      return now >= condition.at;
    case 'passphrase':
      return (
        typeof proof?.passphrase === 'string' &&
        hashPassphrase(proof.passphrase) === condition.hash
      );
  }
}

/**
 * 解锁胶囊。要求：投递时间已到（now >= deliverAt，含恰好相等）
 * 且开启条件满足（条件中的 after 同样在边界时刻判定为满足）。
 * 任一不满足都返回明确错误，胶囊保持原锁定状态。
 */
export function unlockCapsule(
  capsule: Capsule,
  now: number,
  proof?: UnlockProof,
): Result<Capsule> {
  if (!isFiniteNumber(now)) {
    return fail('INVALID_INPUT', '当前时间 now 不合法');
  }
  if (now < capsule.updatedAt) {
    return fail(
      'CLOCK_REGRESSION',
      `当前时间 ${now} 早于上次更新时间 ${capsule.updatedAt}`,
    );
  }
  if (capsule.status === 'unlocked') {
    return fail('ALREADY_UNLOCKED', '胶囊已解锁，不能重复解锁');
  }
  const evaluated = evaluateCapsule(capsule, now);
  if (!evaluated.ok) return evaluated;
  const deliverable = evaluated.value;
  if (deliverable.status === 'sealed') {
    return fail(
      'NOT_DELIVERABLE_YET',
      `投递时间 ${capsule.deliverAt} 尚未到达（当前 ${now}）`,
    );
  }
  if (!checkCondition(deliverable.unlockCondition, now, proof)) {
    return fail(
      'CONDITION_NOT_MET',
      '开启条件尚未满足（after 未到点或口令不匹配）',
    );
  }
  return ok({
    ...deliverable,
    status: 'unlocked',
    unlockedAt: now,
    updatedAt: now,
    version: deliverable.version + 1,
  });
}

/** 供持久化层复用的状态集合。 */
export function isValidStatus(value: unknown): value is CapsuleStatus {
  return typeof value === 'string' && STATUSES.has(value as CapsuleStatus);
}
