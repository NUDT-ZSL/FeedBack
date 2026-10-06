export type CargoCategory = '细色' | '粗色';

export interface CargoItem {
  id: string;
  name: string;
  category: CargoCategory;
  quantity: number;
  unitPrice: number; // 银两 / 单位
}

export interface TariffRule {
  id: string;
  registry: string; // 船籍，'*' 表示通例
  category: CargoCategory | '*';
  rate: number; // 0 ~ 1
}

export type FindingKind = 'quantity' | 'category' | 'new_item';

// 抽检发现：declared 为货单记录快照，observed 为抽检实测，双方均保留
export interface Finding {
  id: string;
  kind: FindingKind;
  cargoItemId: string | null; // 关联货单条目；新增货物为 null
  declared: CargoItem | null;
  observed: CargoItem;
  note?: string;
}

export type InspectionStatus = 'pending' | 'adjudicated';

export interface Inspection {
  id: string;
  seq: number; // 该船第几轮抽检
  initiatedAt: number;
  basisManifestVersion: number; // 发起抽检时的货单版本
  status: InspectionStatus;
  findings: Finding[];
  adjudicatedAt: number | null;
  manifestVersionAtAdjudication: number | null;
  conclusionBefore: ClearanceConclusion | null;
  conclusionAfter: ClearanceConclusion | null;
}

export interface ConclusionLine {
  key: string;
  cargoItemId: string | null;
  name: string;
  category: CargoCategory;
  quantity: number;
  unitPrice: number;
  rate: number;
  tax: number;
  source: 'manifest' | 'ruling';
  declared: CargoItem | null; // 被裁定推翻时保留货单原值
  rulingInspectionId: string | null;
  conflicts: string[];
}

export type ClearanceDecision = 'pass' | 'hold' | 'review';

export interface ClearanceConclusion {
  manifestVersion: number;
  rulingCount: number; // 已生效裁定数，用于一致性比对
  lines: ConclusionLine[];
  totalTax: number;
  decision: ClearanceDecision;
  reasons: string[];
}

export interface Ship {
  id: string;
  name: string;
  registry: string; // 船籍
  captain: string;
  origin: string;
  arrivedAt: number;
  manifest: CargoItem[];
  manifestVersion: number;
  inspections: Inspection[];
  conclusion: ClearanceConclusion;
}

export type ActionResult = { ok: true } | { ok: false; error: string };
