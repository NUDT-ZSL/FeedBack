/**
 * 统一状态存储：工序推进、材料领用、修复记录共享的唯一状态来源。
 *
 * 设计要点：
 * 1. 追加式操作日志（journal）是唯一事实来源，所有模块的读取视图
 *    （进度 / 材料余量 / 修复记录）都由同一份日志派生，任一操作生效后
 *    其他模块立即读到同一结果。
 * 2. 每册书维护单调递增版本号，提交操作需携带读取时的版本号；
 *    版本不一致的并发/连续冲突操作不会被静默覆盖，而是作为冲突
 *    痕迹保留在日志中，当前有效状态仍可明确判定（先提交先生效）。
 * 3. 操作携带幂等键 opId，重复提交（网络重试、双击等）返回首次结果，
 *    不会重复扣减材料或重复追加记录。
 * 4. 材料余量 = 初始库存 - 累计领用 + 累计退回，由日志派生，
 *    工序来回切换不会丢失或重复扣减。
 */

import type {
  BookDef,
  BookProgress,
  ConflictTrace,
  JournalEntry,
  MaterialBalance,
  MaterialDef,
  OpResult,
  Operation,
  RepairRecord,
  StageDef,
  StageTransition,
} from './types';

export interface WorkshopSnapshot {
  stages: StageDef[];
  books: BookDef[];
  progress: BookProgress[];
  materials: MaterialBalance[];
  records: RepairRecord[];
  conflicts: ConflictTrace[];
  journal: JournalEntry[];
}

interface BookState {
  version: number;
  currentStageId: string | null;
  transitions: StageTransition[];
}

interface MaterialState {
  requisitioned: number;
  returned: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class WorkshopStore {
  private readonly stages: StageDef[];
  private readonly books: BookDef[];
  private readonly materials: MaterialDef[];

  /** 唯一事实来源：全部操作（含冲突与被拒绝的）按提交顺序排列 */
  private readonly journal: JournalEntry[] = [];
  /** opId -> 首次提交的日志条目，用于幂等去重 */
  private readonly opIndex = new Map<string, JournalEntry>();

  /** 以下为由日志派生的物化状态，与 rebuildFromJournal() 的重放结果一致 */
  private readonly bookStates = new Map<string, BookState>();
  private readonly materialStates = new Map<string, MaterialState>();
  private readonly records: RepairRecord[] = [];

  constructor(defs: { stages: StageDef[]; books: BookDef[]; materials: MaterialDef[] }) {
    this.stages = clone(defs.stages);
    this.books = clone(defs.books);
    this.materials = clone(defs.materials);
    for (const book of this.books) {
      this.bookStates.set(book.id, { version: 0, currentStageId: null, transitions: [] });
    }
    for (const material of this.materials) {
      this.materialStates.set(material.id, { requisitioned: 0, returned: 0 });
    }
  }

  /* ---------------- 写入口 ---------------- */

  /** 提交操作：同一 opId 幂等；版本冲突保留痕迹且不改状态 */
  submit(op: Operation): OpResult {
    const existing = this.opIndex.get(op.opId);
    if (existing) {
      if (JSON.stringify(existing.op) === JSON.stringify(op)) {
        const state = this.bookStates.get(op.bookId);
        return { status: 'duplicate', entry: clone(existing), version: state?.version ?? 0 };
      }
      const entry = this.append(op, 'rejected', `opId ${op.opId} 已存在但载荷不同`);
      return { status: 'rejected', entry: clone(entry), reason: entry.reason ?? '' };
    }

    const bookState = this.bookStates.get(op.bookId);
    if (!bookState) {
      const entry = this.append(op, 'rejected', `未知古籍: ${op.bookId}`);
      return { status: 'rejected', entry: clone(entry), reason: entry.reason ?? '' };
    }

    if (op.expectedVersion !== bookState.version) {
      const reason =
        `版本冲突：提交基于版本 ${op.expectedVersion}，当前版本 ${bookState.version}，` +
        `操作未生效，已保留冲突痕迹`;
      const entry = this.append(op, 'conflict', reason, bookState.version);
      return { status: 'conflict', entry: clone(entry), version: bookState.version };
    }

    const validationError = this.validate(op);
    if (validationError) {
      const entry = this.append(op, 'rejected', validationError);
      return { status: 'rejected', entry: clone(entry), reason: validationError };
    }

    const entry = this.append(op, 'applied');
    this.apply(op, entry.seq);
    return { status: 'applied', entry: clone(entry), version: bookState.version };
  }

  private append(op: Operation, status: JournalEntry['status'], reason?: string, actualVersion?: number): JournalEntry {
    const entry: JournalEntry = { seq: this.journal.length + 1, op: clone(op), status };
    if (reason) entry.reason = reason;
    if (actualVersion !== undefined) entry.actualVersion = actualVersion;
    this.journal.push(entry);
    // 冲突与生效操作都占用 opId，防止同一 opId 之后以不同结果重放
    if (status !== 'rejected') this.opIndex.set(op.opId, entry);
    return entry;
  }

  private validate(op: Operation): string | null {
    switch (op.kind) {
      case 'advance_stage':
        if (!this.stages.some((s) => s.id === op.toStageId)) return `未知工序: ${op.toStageId}`;
        return null;
      case 'requisition_material': {
        if (!Number.isInteger(op.quantity) || op.quantity <= 0) return '领用数量必须为正整数';
        const def = this.materials.find((m) => m.id === op.materialId);
        if (!def) return `未知材料: ${op.materialId}`;
        const state = this.materialStates.get(op.materialId)!;
        const balance = def.initialStock - state.requisitioned + state.returned;
        if (op.quantity > balance) return `材料「${def.name}」余量不足：余 ${balance}，申领 ${op.quantity}`;
        return null;
      }
      case 'return_material': {
        if (!Number.isInteger(op.quantity) || op.quantity <= 0) return '退回数量必须为正整数';
        const def = this.materials.find((m) => m.id === op.materialId);
        if (!def) return `未知材料: ${op.materialId}`;
        const outstanding = this.outstandingOf(op.bookId, op.materialId);
        if (op.quantity > outstanding) {
          return `退回超过该册未归还领用量：未归还 ${outstanding}，退回 ${op.quantity}`;
        }
        return null;
      }
      case 'add_record':
        if (!this.stages.some((s) => s.id === op.stageId)) return `未知工序: ${op.stageId}`;
        if (!op.content.trim()) return '修复记录内容不能为空';
        return null;
    }
  }

  private apply(op: Operation, seq: number): void {
    const bookState = this.bookStates.get(op.bookId)!;
    switch (op.kind) {
      case 'advance_stage':
        bookState.transitions.push({ seq, fromStageId: bookState.currentStageId, toStageId: op.toStageId, actor: op.actor });
        bookState.currentStageId = op.toStageId;
        break;
      case 'requisition_material':
        this.materialStates.get(op.materialId)!.requisitioned += op.quantity;
        break;
      case 'return_material':
        this.materialStates.get(op.materialId)!.returned += op.quantity;
        break;
      case 'add_record':
        this.records.push({ seq, bookId: op.bookId, stageId: op.stageId, content: op.content, actor: op.actor });
        break;
    }
    bookState.version += 1;
  }

  /* ---------------- 读视图（三个模块共享） ---------------- */

  getStages(): StageDef[] {
    return clone(this.stages);
  }

  getBooks(): BookDef[] {
    return clone(this.books);
  }

  /** 工序模块视图 */
  getProgress(bookId: string): BookProgress {
    const state = this.bookStates.get(bookId);
    if (!state) throw new Error(`未知古籍: ${bookId}`);
    return { bookId, version: state.version, currentStageId: state.currentStageId, transitions: clone(state.transitions) };
  }

  /** 材料模块视图：余量由日志派生 */
  getMaterials(): MaterialBalance[] {
    return this.materials.map((def) => {
      const state = this.materialStates.get(def.id)!;
      return {
        materialId: def.id,
        name: def.name,
        unit: def.unit,
        initialStock: def.initialStock,
        requisitioned: state.requisitioned,
        returned: state.returned,
        balance: def.initialStock - state.requisitioned + state.returned,
      };
    });
  }

  /** 某册书对某材料的未归还领用量（退回校验与对账用） */
  outstandingOf(bookId: string, materialId: string): number {
    let outstanding = 0;
    for (const entry of this.journal) {
      if (entry.status !== 'applied' || entry.op.bookId !== bookId) continue;
      if (entry.op.kind === 'requisition_material' && entry.op.materialId === materialId) outstanding += entry.op.quantity;
      if (entry.op.kind === 'return_material' && entry.op.materialId === materialId) outstanding -= entry.op.quantity;
    }
    return outstanding;
  }

  /** 修复记录模块视图 */
  getRecords(bookId?: string): RepairRecord[] {
    return clone(bookId ? this.records.filter((r) => r.bookId === bookId) : this.records);
  }

  /** 冲突痕迹：可判断哪次操作被拦下、当时的有效版本是什么 */
  getConflicts(bookId?: string): ConflictTrace[] {
    const traces = this.journal
      .filter((e) => e.status === 'conflict')
      .map((e) => ({ seq: e.seq, op: clone(e.op), reason: e.reason ?? '', actualVersion: e.actualVersion ?? 0 }));
    return bookId ? traces.filter((t) => t.op.bookId === bookId) : traces;
  }

  getJournal(): JournalEntry[] {
    return clone(this.journal);
  }

  /** 一次性快照：前端/ API 各模块读取同一份结果 */
  getSnapshot(): WorkshopSnapshot {
    return {
      stages: this.getStages(),
      books: this.getBooks(),
      progress: this.books.map((b) => this.getProgress(b.id)),
      materials: this.getMaterials(),
      records: this.getRecords(),
      conflicts: this.getConflicts(),
      journal: this.getJournal(),
    };
  }

  /* ---------------- 迁移与一致性校验支撑 ---------------- */

  /**
   * 从日志重建全部派生状态并替换物化状态。
   * 用于迁移后校验：物化状态必须与日志重放结果完全一致。
   */
  rebuildFromJournal(): void {
    for (const book of this.books) {
      this.bookStates.set(book.id, { version: 0, currentStageId: null, transitions: [] });
    }
    for (const material of this.materials) {
      this.materialStates.set(material.id, { requisitioned: 0, returned: 0 });
    }
    this.records.length = 0;
    for (const entry of this.journal) {
      if (entry.status === 'applied') this.apply(entry.op, entry.seq);
    }
  }

  /** 深比较当前物化状态与日志重放结果是否一致（一致性自检） */
  checkMaterializedMatchesJournal(): boolean {
    const before = {
      progress: this.books.map((b) => this.getProgress(b.id)),
      materials: this.getMaterials(),
      records: this.getRecords(),
    };
    this.rebuildFromJournal();
    const after = {
      progress: this.books.map((b) => this.getProgress(b.id)),
      materials: this.getMaterials(),
      records: this.getRecords(),
    };
    return JSON.stringify(before) === JSON.stringify(after);
  }
}
