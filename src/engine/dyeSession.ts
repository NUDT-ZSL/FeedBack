/**
 * 浸染会话层：把"操作事件"收敛为对推演模块的有序调用。
 *
 * 职责：
 * - 幂等 / 去重：同一 opId 的浸染操作只生效一次；氧化窗口内的重复点击被拒绝。
 * - 参数变更：走 deriveAffected 增量重算，与全量重算结果一致。
 * - 可回放：给定相同参数与事件序列，replay 必然得到相同状态（离线可验证）。
 *
 * 数据流：UI 事件 -> DyeSession -> dyeEngine 推演 -> UI 只读快照。
 */
import {
  DEFAULT_PARAMS,
  MIN_INTERVAL_SEC,
  deriveAffected,
  deriveAll,
  sanitizeParams,
  type DyeDerivation,
  type DyeParamKey,
  type DyeParams,
} from './dyeEngine.ts';

/** 一次已生效的浸染记录（对应 PRD 的 DyeRecord）。 */
export interface DyeRecord {
  id: string;
  round: number;
  timestamp: string;
  oxidationSeconds: number;
  colorHex: string;
  colorDepth: number;
  concentrationAfter: number;
}

export type DipRejectReason = 'duplicate' | 'oxidizing';

export interface DipOutcome {
  applied: boolean;
  reason?: DipRejectReason;
  record?: DyeRecord;
}

export interface SessionSnapshot {
  params: DyeParams;
  derivation: DyeDerivation;
  records: readonly DyeRecord[];
  lastDipAtMs: number | null;
}

let recordSeq = 0;
function nextRecordId(): string {
  recordSeq += 1;
  return `rec-${recordSeq}`;
}

export class DyeSession {
  private params: DyeParams;
  private derivation: DyeDerivation;
  private records: DyeRecord[] = [];
  private appliedOpIds = new Set<string>();
  private lastDipAtMs: number | null = null;

  constructor(params?: Partial<DyeParams>) {
    this.params = sanitizeParams({ ...DEFAULT_PARAMS, ...params });
    this.derivation = deriveAll(this.params);
  }

  /** 当前只读快照：界面各处的唯一数据源。 */
  snapshot(): SessionSnapshot {
    return {
      params: this.params,
      derivation: this.derivation,
      records: this.records,
      lastDipAtMs: this.lastDipAtMs,
    };
  }

  /**
   * 修改参数：只增量重算受影响字段。
   * 浸染次数不通过该接口修改（次数只能由浸染操作推进）。
   */
  setParams(patch: Partial<Omit<DyeParams, 'dipCount'>>): SessionSnapshot {
    const changedKeys = (Object.keys(patch) as DyeParamKey[]).filter(
      (key) => patch[key as keyof typeof patch] !== undefined,
    );
    if (changedKeys.length === 0) {
      return this.snapshot();
    }
    this.params = sanitizeParams({ ...this.params, ...patch, dipCount: this.records.length });
    this.derivation = deriveAffected(this.derivation, this.params, changedKeys);
    return this.snapshot();
  }

  /** 氧化窗口剩余毫秒数；窗口内不允许再次浸染。 */
  oxidationRemainingMs(atMs: number): number {
    if (this.lastDipAtMs === null) {
      return 0;
    }
    const elapsed = atMs - this.lastDipAtMs;
    const remaining = MIN_INTERVAL_SEC * 1000 - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  canDip(atMs: number): boolean {
    return this.oxidationRemainingMs(atMs) <= 0;
  }

  /**
   * 浸染一次。
   * - opId 已生效过 -> 幂等拒绝（duplicate），状态不变；
   * - 处于氧化窗口内 -> 拒绝（oxidizing），状态不变；
   * 连续快速点击因此最多只生效一次。
   */
  dip(opId: string, atMs: number): DipOutcome {
    if (this.appliedOpIds.has(opId)) {
      return { applied: false, reason: 'duplicate' };
    }
    if (!this.canDip(atMs)) {
      return { applied: false, reason: 'oxidizing' };
    }
    this.appliedOpIds.add(opId);
    this.lastDipAtMs = atMs;

    this.params = sanitizeParams({ ...this.params, dipCount: this.records.length + 1 });
    this.derivation = deriveAffected(this.derivation, this.params, ['dipCount']);

    const record: DyeRecord = {
      id: nextRecordId(),
      round: this.records.length + 1,
      timestamp: new Date(atMs).toISOString(),
      oxidationSeconds: this.params.airDurationSec,
      colorHex: this.derivation.colorHex,
      colorDepth: this.derivation.colorDepth,
      concentrationAfter: this.derivation.concentrationAfter,
    };
    this.records.push(record);
    return { applied: true, record };
  }

  /** 回退到第 round 轮之后的状态（round=0 表示回到未浸染）。 */
  revertTo(round: number): SessionSnapshot {
    const target = Math.max(0, Math.min(this.records.length, Math.trunc(round)));
    this.records = this.records.slice(0, target);
    this.params = sanitizeParams({ ...this.params, dipCount: target });
    this.derivation = deriveAll(this.params);
    return this.snapshot();
  }

  /**
   * 离线回放：从同一初始参数出发，按顺序应用事件，
   * 结果与在线逐步操作完全一致（用于可重复验证）。
   */
  static replay(
    params: Partial<DyeParams>,
    events: ReadonlyArray<{ opId: string; atMs: number }>,
  ): SessionSnapshot {
    const session = new DyeSession(params);
    for (const event of events) {
      session.dip(event.opId, event.atMs);
    }
    return session.snapshot();
  }
}
