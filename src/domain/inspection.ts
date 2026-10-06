import type { CargoEntry, Inspection, OpResult, RulingAction } from './types';
import { fail, ok } from './types';

export function pendingInspectionOf(inspections: Inspection[], shipId: string): Inspection | null {
  return inspections.find((i) => i.shipId === shipId && i.status === 'pending') ?? null;
}

export function inspectionsOf(inspections: Inspection[], shipId: string): Inspection[] {
  return inspections
    .filter((i) => i.shipId === shipId)
    .sort((a, b) => a.initiatedAt - b.initiatedAt || a.round - b.round);
}

/** 同一艘商船在裁定完成前不允许再次发起抽检 */
export function canInitiateInspection(inspections: Inspection[], shipId: string): OpResult {
  const pending = pendingInspectionOf(inspections, shipId);
  if (pending) return fail(`第 ${pending.round} 轮抽检尚未裁定，不得再次发起`);
  return ok;
}

/** 裁定完成前不允许修改该船货单 */
export function canEditManifest(inspections: Inspection[], shipId: string): OpResult {
  const pending = pendingInspectionOf(inspections, shipId);
  if (pending) return fail(`第 ${pending.round} 轮抽检待裁定，货单已封存`);
  return ok;
}

/** 任一商船存在待裁定抽检时，关税口径冻结 */
export function canEditSchedule(inspections: Inspection[]): OpResult {
  const pending = inspections.filter((i) => i.status === 'pending');
  if (pending.length > 0) return fail(`尚有 ${pending.length} 宗抽检待裁定，关税口径冻结`);
  return ok;
}

/** 登记抽检发现：与货单冲突的条目标记 disputed，双方保留、各标来源 */
export function markFindingConflict(manifest: CargoEntry[], targetEntryId: string | null): CargoEntry[] {
  if (!targetEntryId) return manifest;
  return manifest.map((e) => (e.id === targetEntryId && e.status === 'active' ? { ...e, status: 'disputed' } : e));
}

/** 撤回一条抽检发现：若该货单条目无其他冲突发现则恢复有效 */
export function unmarkFindingConflict(
  manifest: CargoEntry[],
  inspection: Inspection,
  removedFindingId: string,
): CargoEntry[] {
  const removed = inspection.findings.find((f) => f.id === removedFindingId);
  if (!removed?.targetEntryId) return manifest;
  const stillTargeted = inspection.findings.some(
    (f) => f.id !== removedFindingId && f.targetEntryId === removed.targetEntryId,
  );
  if (stillTargeted) return manifest;
  return manifest.map((e) => (e.id === removed.targetEntryId && e.status === 'disputed' ? { ...e, status: 'active' } : e));
}

/**
 * 裁定落地：把每条抽检发现按裁定结果写入货单。
 * 冲突双方均保留——被取代的一方标记 superseded 留档，绝不删除。
 */
export function applyRulingToManifest(
  manifest: CargoEntry[],
  inspection: Inspection,
  decisions: Record<string, RulingAction>,
): CargoEntry[] {
  const next = manifest.map((e) => ({ ...e }));
  for (const finding of inspection.findings) {
    const action = decisions[finding.id];
    if (!action) throw new Error(`抽检记录 ${finding.id} 缺少裁定`);
    const target = finding.targetEntryId ? next.find((e) => e.id === finding.targetEntryId) : undefined;
    const inspectionEntry: CargoEntry = {
      id: `${finding.id}-entry`,
      name: finding.name,
      category: finding.category,
      quantity: finding.quantity,
      unitValue: finding.unitValue,
      source: 'inspection',
      status: 'active',
      addedByInspectionId: inspection.id,
    };
    if (target && action === 'adopt-inspection') {
      target.status = 'superseded';
      next.push(inspectionEntry);
    } else if (target && action === 'keep-manifest') {
      target.status = 'active';
      next.push({ ...inspectionEntry, status: 'superseded' });
    } else {
      if (target) target.status = 'active';
      next.push(inspectionEntry);
    }
  }
  return next;
}
