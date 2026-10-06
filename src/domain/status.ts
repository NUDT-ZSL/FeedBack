import type { Inspection, Ruling } from './types';

/** 商船裁定状态：未抽检 / 抽检待裁定 / 已裁定 / 结论被推翻 */
export type ShipRulingStatus = 'none' | 'pending' | 'adjudicated' | 'overturned';

export const RULING_STATUS_LABEL: Record<ShipRulingStatus, string> = {
  none: '未抽检',
  pending: '抽检待裁定',
  adjudicated: '已裁定',
  overturned: '结论被推翻',
};

/** 裁定是否推翻了落地前的结论（税额或通关结论有变化） */
export function conclusionOverturned(ruling: Ruling): boolean {
  const before = ruling.conclusionBefore;
  const after = ruling.conclusionAfter;
  if (!before) return true;
  return before.totalDuty !== after.totalDuty || before.grade !== after.grade;
}

export function shipRulingStatus(shipId: string, inspections: Inspection[]): ShipRulingStatus {
  const list = inspections.filter((i) => i.shipId === shipId);
  if (list.some((i) => i.status === 'pending')) return 'pending';
  const ruled = list.filter((i) => i.ruling);
  if (ruled.length === 0) return 'none';
  return ruled.some((i) => conclusionOverturned(i.ruling!)) ? 'overturned' : 'adjudicated';
}
