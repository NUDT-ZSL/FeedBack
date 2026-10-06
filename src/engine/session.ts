/**
 * 问诊会话：面向界面/脚本的追加式采集与裁决入口。
 *
 * - collect() 只追加记录，绝不覆盖既有记录；
 * - 记录 id 与默认逻辑时刻均由内部计数器产生，保证同一会话可复现；
 * - getResult() 优先走增量重推（只重推受影响的证候与方剂），
 *   首次或显式要求时走全量推演。
 */
import { DEFAULT_KNOWLEDGE, type KnowledgeBase } from './knowledge.js';
import { derive, deriveIncremental, type Derivation } from './engine.js';
import { partitionRecords } from './graph.js';
import type {
  ConflictGroup,
  InferenceResult,
  ObservationKind,
  ObservationRecord,
} from './types.js';

export class DiagnosisSession {
  private records: ObservationRecord[] = [];
  private derivation: Derivation | null = null;
  private dirtyIds: string[] = [];
  private counter = 0;
  private clock: () => number;

  constructor(
    private knowledge: KnowledgeBase = DEFAULT_KNOWLEDGE,
    now?: () => number
  ) {
    // 默认使用内部逻辑时钟（0,1,2,...），不依赖系统时间
    this.clock = now ?? (() => this.counter - 1);
  }

  collect(
    kind: ObservationKind,
    key: string,
    value: string,
    source: string,
    collectedAt?: number
  ): ObservationRecord {
    this.counter += 1;
    const record: ObservationRecord = {
      id: `rec-${String(this.counter).padStart(4, '0')}`,
      kind,
      key,
      value,
      source,
      collectedAt: collectedAt ?? this.clock(),
      status: 'pending',
    };
    this.records.push(record);
    this.dirtyIds.push(record.id);
    return record;
  }

  /** 裁决某采集项：采纳 acceptId，同组其余有效记录全部置为弃用 */
  adjudicate(kind: ObservationKind, key: string, acceptId: string): void {
    for (const rec of this.records) {
      if (rec.kind !== kind || rec.key !== key || rec.status === 'rejected') continue;
      const next = rec.id === acceptId ? 'adjudicated' : 'rejected';
      if (rec.status !== next) {
        rec.status = next;
        this.dirtyIds.push(rec.id);
      }
    }
  }

  /** 修正一条采集记录的值（等价于弃用旧值 + 追加新记录，保留审计轨迹） */
  correct(recordId: string, newValue: string, source?: string): ObservationRecord | null {
    const origin = this.records.find((r) => r.id === recordId);
    if (!origin) return null;
    if (origin.status !== 'rejected') {
      origin.status = 'rejected';
      this.dirtyIds.push(origin.id);
    }
    const rec = this.collect(origin.kind, origin.key, newValue, source ?? origin.source);
    rec.status = 'adjudicated';
    return rec;
  }

  getRecords(): ObservationRecord[] {
    return [...this.records];
  }

  getConflicts(): ConflictGroup[] {
    return partitionRecords(this.records).conflicts;
  }

  /** 全量推演（忽略缓存） */
  runFull(): InferenceResult {
    this.derivation = derive({ records: this.getRecords() }, this.knowledge);
    this.dirtyIds = [];
    return this.derivation.result;
  }

  /** 默认入口：有缓存时增量重推，否则全量推演 */
  getResult(): InferenceResult {
    if (!this.derivation) return this.runFull();
    if (this.dirtyIds.length === 0) return this.derivation.result;
    this.derivation = deriveIncremental(
      this.derivation,
      { records: this.getRecords() },
      [...new Set(this.dirtyIds)]
    );
    this.dirtyIds = [];
    return this.derivation.result;
  }
}
