import type { ActionResult, CargoItem, Finding, Ship, TariffRule } from './types';
import { pendingOf, recompute } from './recompute';

let counter = 0;
export function genId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

// 抽检待裁定期间，货单与关税口径均锁定
export function manifestLockReason(ship: Ship): string | null {
  const pending = pendingOf(ship);
  return pending ? `第 ${pending.seq} 轮抽检待裁定，货单已锁定` : null;
}

export function initiateInspection(
  ship: Ship,
  rules: TariffRule[],
  now: number,
): { ship?: Ship; error?: string } {
  const pending = pendingOf(ship);
  if (pending) return { error: `第 ${pending.seq} 轮抽检尚未裁定，不得重复发起` };
  const inspection = {
    id: genId('insp'),
    seq: ship.inspections.length + 1,
    initiatedAt: now,
    basisManifestVersion: ship.manifestVersion,
    status: 'pending' as const,
    findings: [],
    adjudicatedAt: null,
    manifestVersionAtAdjudication: null,
    conclusionBefore: null,
    conclusionAfter: null,
  };
  const next: Ship = { ...ship, inspections: [...ship.inspections, inspection] };
  return { ship: { ...next, conclusion: recompute(next, rules) } };
}

export function applyManifestEdit(
  ship: Ship,
  edit: (manifest: CargoItem[]) => CargoItem[],
  rules: TariffRule[],
): { ship?: Ship; error?: string } {
  const locked = manifestLockReason(ship);
  if (locked) return { error: locked };
  const next: Ship = {
    ...ship,
    manifest: edit(ship.manifest),
    manifestVersion: ship.manifestVersion + 1,
  };
  return { ship: { ...next, conclusion: recompute(next, rules) } };
}

export function adjudicate(
  ship: Ship,
  inspectionId: string,
  findings: Finding[],
  rules: TariffRule[],
  now: number,
): { ship?: Ship; error?: string } {
  const inspection = ship.inspections.find((i) => i.id === inspectionId);
  if (!inspection) return { error: '抽检记录不存在' };
  if (inspection.status !== 'pending') return { error: '该抽检已裁定，不得重复落地' };
  if (ship.manifestVersion !== inspection.basisManifestVersion) {
    return { error: '货单已于抽检期间变更，裁定依据失效，请作废后重新发起' };
  }
  const conclusionBefore = ship.conclusion;
  const done = {
    ...inspection,
    status: 'adjudicated' as const,
    findings,
    adjudicatedAt: now,
    manifestVersionAtAdjudication: ship.manifestVersion,
    conclusionBefore,
  };
  const next: Ship = {
    ...ship,
    inspections: ship.inspections.map((i) => (i.id === inspectionId ? done : i)),
  };
  const conclusion = recompute(next, rules);
  const finalized = {
    ...next,
    inspections: next.inspections.map((i) =>
      i.id === inspectionId ? { ...done, conclusionAfter: conclusion } : i,
    ),
  };
  return { ship: { ...finalized, conclusion } };
}

export function voidInspection(
  ship: Ship,
  inspectionId: string,
  rules: TariffRule[],
): { ship?: Ship; error?: string } {
  const inspection = ship.inspections.find((i) => i.id === inspectionId);
  if (!inspection) return { error: '抽检记录不存在' };
  if (inspection.status !== 'pending') return { error: '已落地的裁定不可撤销' };
  const next: Ship = {
    ...ship,
    inspections: ship.inspections.filter((i) => i.id !== inspectionId),
  };
  return { ship: { ...next, conclusion: recompute(next, rules) } };
}

export { ok, fail };
