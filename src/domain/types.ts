export type Origin = '高丽' | '日本' | '大食' | '三佛齐' | '占城' | '本港';

export type CargoCategory = '香料' | '药材' | '珠宝' | '丝绸' | '瓷器' | '杂货';

/** 条目来源：货单登记 / 抽检实测 */
export type CargoSource = 'manifest' | 'inspection';

/**
 * 条目状态：
 * - active     当前有效，参与关税计算
 * - disputed   与抽检记录冲突，候裁（不参与计算）
 * - superseded 已被裁定取代，仅留档追溯（不参与计算）
 */
export type CargoStatus = 'active' | 'disputed' | 'superseded';

export interface CargoEntry {
  id: string;
  name: string;
  category: CargoCategory;
  quantity: number;
  unitValue: number;
  source: CargoSource;
  status: CargoStatus;
  addedByInspectionId?: string;
}

/** 关税口径：按货物类别的基础税率 + 按船籍的加减（百分点） */
export interface TariffSchedule {
  version: number;
  categoryRates: Record<CargoCategory, number>;
  originAdjust: Record<Origin, number>;
}

export interface DutyLine {
  entryId: string;
  name: string;
  category: CargoCategory;
  source: CargoSource;
  quantity: number;
  unitValue: number;
  rate: number;
  duty: number;
}

/** pass 准予通关 / review 补税复核 / detain 暂扣候裁 */
export type ClearanceGrade = 'pass' | 'review' | 'detain';

export interface ClearanceConclusion {
  lines: DutyLine[];
  totalDuty: number;
  grade: ClearanceGrade;
  scheduleVersion: number;
  computedAt: number;
  reason: string;
}

export interface InspectionFinding {
  id: string;
  /** 冲突对应的货单条目；新发现货物为 null */
  targetEntryId: string | null;
  name: string;
  category: CargoCategory;
  quantity: number;
  unitValue: number;
  note: string;
}

/** adopt-inspection 采纳抽检 / keep-manifest 保留货单 / add-entry 登记新条目 */
export type RulingAction = 'adopt-inspection' | 'keep-manifest' | 'add-entry';

export interface RulingDecision {
  findingId: string;
  action: RulingAction;
}

export interface Ruling {
  id: string;
  adjudicatedAt: number;
  decisions: RulingDecision[];
  /** 裁定依据：裁定落地时的货单快照，日后货单变更也不覆盖 */
  basisManifest: CargoEntry[];
  basisManifestVersion: number;
  conclusionBefore: ClearanceConclusion | null;
  conclusionAfter: ClearanceConclusion;
  /** 裁定落地后货单又被外部修正 */
  manifestChangedAfter: boolean;
  note: string;
}

export type InspectionStatus = 'pending' | 'adjudicated';

export interface Inspection {
  id: string;
  shipId: string;
  round: number;
  initiatedAt: number;
  status: InspectionStatus;
  findings: InspectionFinding[];
  ruling: Ruling | null;
}

export interface Ship {
  id: string;
  name: string;
  captain: string;
  origin: Origin;
  /** 载重（石） */
  tonnage: number;
  arrivedAt: number;
  manifest: CargoEntry[];
  /** 外部修正货单时递增；裁定本身不递增 */
  manifestVersion: number;
  conclusion: ClearanceConclusion | null;
}

export interface OpResult {
  ok: boolean;
  reason?: string;
}

export const ok: OpResult = { ok: true };
export const fail = (reason: string): OpResult => ({ ok: false, reason });

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
