/**
 * 推演链路领域模型。
 * 引擎层为纯函数：不依赖 DOM / React / 时间，任意时刻同输入必同输出。
 */

/** 玉料：单位为「料」(抽象余量单位) */
export interface JadeMaterial {
  id: string;
  name: string;
  /** 莫氏硬度 1~10，越硬损耗系数越大 */
  hardness: number;
  /** 尺寸 (cm)，仅记录，用于人工核对 */
  sizeCm: number;
  /** 余量 */
  remaining: number;
  /** 来源标记（坑口/采买批次） */
  source: string;
}

/** 解玉砂批次 */
export interface SandBatch {
  id: string;
  name: string;
  /** 粒度，单位目；目数越大砂越细 */
  grit: number;
  /**
   * 配比（砂水比 0~1）：每单位砂浆中的纯砂比例。
   * 配比越高，达成同等切削所需砂耗越少、玉料损耗也越低（浆更“稳”）。
   */
  ratio: number;
  /** 库存纯砂，单位斤 */
  stock: number;
  /** 适用工序名称集合（工序语义白名单） */
  applicable: string[];
}

/** 工序配置 */
export interface ProcessStep {
  id: string;
  name: string;
  /** 禁用：裁决入口可选择暂停某竞争工序，禁用后不参与推演 */
  disabled?: boolean;
  /** 所需玉料 id（仅记录归属；消耗按工序在玉料上的损耗计） */
  materialId: string;
  /** 所用解玉砂 id，空串表示不用砂 */
  sandId: string;
  /** 所需砂量基数（标准配比下的纯砂需求，单位斤） */
  sandBase: number;
  /** 前置工序 id */
  prerequisites: string[];
  /** 预计耗时（刻） */
  duration: number;
  /** 该工序切削强度系数，影响玉料损耗 */
  intensity: number;
}

/** 完整推演输入 */
export interface WorkshopConfig {
  materials: JadeMaterial[];
  sands: SandBatch[];
  steps: ProcessStep[];
}

export type StepStatus =
  | "ready" // 可执行（且资源充足）
  | "blocked" // 被前置结构/资源卡住
  | "skipped"; // 禁用或引用缺失，结构上不参与

/** 单个工序的执行结算 */
export interface StepOutcome {
  stepId: string;
  status: StepStatus;
  /** 实际执行次序，0 起；不执行时为 -1 */
  order: number;
  /** 有效砂耗（斤） */
  sandUsed: number;
  /** 玉料损耗（料单位） */
  jadeLoss: number;
  sandId: string;
  materialId: string;
  /** 结算后该工序所引玉料余量 / 砂库存 */
  materialAfter: number | null;
  sandAfter: number | null;
  /** 该工序未满足的原因码 */
  reasons: string[];
}

export type ConflictKind =
  | "cycle" // 依赖成环：保留环上每一方
  | "missing-ref" // 前置/玉料/砂引用缺失
  | "material-shortage" // 玉料余量不足：保留本工序与同料竞争方
  | "sand-shortage" // 砂库存不足：保留本工序与同砂竞争方
  | "sand-not-applicable"; // 砂的适用工序不含本工序

export interface Conflict {
  id: string;
  kind: ConflictKind;
  /** 主体工序 id（环冲突时为环中按 id 最小者） */
  subjectId: string;
  /** 冲突相关双方/多方的工序 id（全部保留，不静默择一） */
  partyIds: string[];
  resourceId?: string;
  message: string;
  detail: Record<string, unknown>;
}

/** 一次裁决操作（结构化补丁，可回放） */
export interface Adjudication {
  id: string;
  at: number;
  conflictId: string;
  action: string;
  label: string;
  patch: EditPatch;
}

export interface EditPatch {
  sand?: Record<string, Partial<SandBatch>>;
  material?: Record<string, Partial<JadeMaterial>>;
  step?: Record<string, Partial<ProcessStep>>;
}

/** 资源逐工序消耗分布 */
export interface ConsumptionRow {
  order: number;
  stepId: string;
  stepName: string;
  resource: string; // 玉料名 或 砂名
  resourceKind: "jade" | "sand";
  before: number;
  used: number;
  after: number;
}

/** 配比跨工序影响（相对某基线结果） */
export interface RatioImpactRow {
  sandId: string;
  sandName: string;
  affectedStepIds: string[];
  /** 各工序砂耗合计变化（当前 - 基线，负为节省） */
  sandDelta: number;
  /** 各工序玉料损耗合计变化 */
  jadeLossDelta: number;
}

/** 成品产出结论 */
export interface ProductVerdict {
  productName: string;
  completable: boolean;
  executedSteps: number;
  totalSteps: number;
  totalDuration: number;
  endingMaterialId: string | null;
  endingMaterialRemaining: number | null;
  summary: string;
}

export interface InferenceResult {
  /** 可执行顺序（结构合法且按序结算成功） */
  order: string[];
  outcomes: Record<string, StepOutcome>;
  conflicts: Conflict[];
  consumption: ConsumptionRow[];
  /** 各玉料 / 砂 的最终余量 */
  materialFinal: Record<string, number>;
  sandFinal: Record<string, number>;
  product: ProductVerdict;
  /** 全量/增量两种入口产出结构一致，元数据供核对 */
  /** 结构层快照：全量/增量入口必然相同，供批量比对 */
  structure: {
    topoOrder: string[];
    blocked: Record<string, string[]>;
    cycles: string[][];
    missing: string[];
  };
  meta: {
    mode: "full" | "incremental";
    executed: number;
    blocked: number;
    skipped: number;
    recomputed: number;
    reused: number;
  };
}
