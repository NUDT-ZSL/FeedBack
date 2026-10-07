/**
 * 胶囊服务层：在纯函数状态机之上提供
 * - 操作日志（opId）幂等：同一操作重复提交返回首次结果，不重复生效；
 * - 乐观并发（expectedVersion）：版本不匹配明确拒绝，绝不静默择一；
 * - 顺序应用：操作按提交顺序生效，最终状态由顺序唯一确定。
 */

import {
  createCapsule,
  editCapsule,
  evaluateCapsule,
  unlockCapsule,
  type Capsule,
  type CapsuleErrorCode,
  type CapsulePatch,
  type Result,
  type UnlockCondition,
  type UnlockProof,
} from './capsule.ts';

export type CapsuleOp =
  | {
      opId: string;
      kind: 'create';
      id: string;
      title: string;
      content: string;
      deliverAt: number;
      unlockCondition?: UnlockCondition;
      now: number;
    }
  | {
      opId: string;
      kind: 'edit';
      id: string;
      expectedVersion: number;
      patch: CapsulePatch;
      now: number;
    }
  | { opId: string; kind: 'evaluate'; id: string; now: number }
  | {
      opId: string;
      kind: 'unlock';
      id: string;
      expectedVersion: number;
      proof?: UnlockProof;
      now: number;
    };

export type ServiceErrorCode =
  | CapsuleErrorCode
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'VERSION_CONFLICT'
  | 'INVALID_OP';

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
}

export type ServiceResult =
  | { ok: true; capsule: Capsule; replayed: boolean }
  | { ok: false; error: ServiceError; replayed: boolean };

function succeeded(capsule: Capsule): ServiceResult {
  return { ok: true, capsule, replayed: false };
}

function rejected(code: ServiceErrorCode, message: string): ServiceResult {
  return { ok: false, error: { code, message }, replayed: false };
}

function fromDomain(result: Result<Capsule>): ServiceResult {
  return result.ok
    ? succeeded(result.value)
    : rejected(result.error.code, result.error.message);
}

export class CapsuleService {
  private capsules = new Map<string, Capsule>();
  private journal = new Map<string, ServiceResult>();

  /** 提交一个操作。相同 opId 重放时返回首次记录的结果，不重复应用。 */
  submit(op: CapsuleOp): ServiceResult {
    if (typeof op.opId !== 'string' || op.opId.length === 0) {
      return rejected('INVALID_OP', '操作缺少 opId');
    }
    const recorded = this.journal.get(op.opId);
    if (recorded !== undefined) {
      return { ...recorded, replayed: true };
    }
    const result = this.apply(op);
    this.journal.set(op.opId, result);
    return result;
  }

  private apply(op: CapsuleOp): ServiceResult {
    if (op.kind === 'create') {
      if (this.capsules.has(op.id)) {
        return rejected('ALREADY_EXISTS', `胶囊 ${op.id} 已存在`);
      }
      const created = createCapsule(
        {
          id: op.id,
          title: op.title,
          content: op.content,
          deliverAt: op.deliverAt,
          unlockCondition: op.unlockCondition,
        },
        op.now,
      );
      if (!created.ok) return fromDomain(created);
      this.capsules.set(op.id, created.value);
      return succeeded(created.value);
    }

    const current = this.capsules.get(op.id);
    if (current === undefined) {
      return rejected('NOT_FOUND', `胶囊 ${op.id} 不存在`);
    }

    if (op.kind === 'evaluate') {
      const evaluated = evaluateCapsule(current, op.now);
      if (!evaluated.ok) return fromDomain(evaluated);
      this.capsules.set(op.id, evaluated.value);
      return succeeded(evaluated.value);
    }

    if (op.expectedVersion !== current.version) {
      return rejected(
        'VERSION_CONFLICT',
        `版本冲突：期望 v${op.expectedVersion}，实际 v${current.version}，操作被拒绝`,
      );
    }

    if (op.kind === 'edit') {
      const edited = editCapsule(current, op.patch, op.now);
      if (!edited.ok) return fromDomain(edited);
      this.capsules.set(op.id, edited.value);
      return succeeded(edited.value);
    }

    const unlocked = unlockCapsule(current, op.now, op.proof);
    if (!unlocked.ok) return fromDomain(unlocked);
    this.capsules.set(op.id, unlocked.value);
    return succeeded(unlocked.value);
  }

  /** 读取胶囊快照（深拷贝，外部修改不影响内部状态）。 */
  get(id: string): Capsule | undefined {
    const capsule = this.capsules.get(id);
    return capsule === undefined ? undefined : structuredClone(capsule);
  }

  /** 按创建顺序列出全部胶囊快照。 */
  list(): Capsule[] {
    return [...this.capsules.values()].map((capsule) =>
      structuredClone(capsule),
    );
  }
}
