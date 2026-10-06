import { buildConclusion } from './clearance';
import { applyRulingToManifest } from './inspection';
import type { CargoEntry, Inspection, Ruling, RulingAction, Ship, TariffSchedule } from './types';

/** 从头重算整船通关结论（验讫 / 货单修正 / 口径调整共用此入口） */
export function recomputeShip(ship: Ship, schedule: TariffSchedule, at: number): Ship {
  return { ...ship, conclusion: buildConclusion(ship.origin, ship.manifest, schedule, at) };
}

/**
 * 货单被外部修正：版本递增、整船结论从头重推；
 * 已落地的裁定不被覆盖——保留裁定依据快照，仅标记「货单已变更」。
 */
export function applyExternalManifestEdit(
  ship: Ship,
  inspections: Inspection[],
  mutate: (manifest: CargoEntry[]) => CargoEntry[],
  schedule: TariffSchedule,
  at: number,
): { ship: Ship; inspections: Inspection[] } {
  const manifest = mutate(ship.manifest);
  const manifestVersion = ship.manifestVersion + 1;
  const nextShip: Ship = {
    ...ship,
    manifest,
    manifestVersion,
    conclusion: buildConclusion(ship.origin, manifest, schedule, at),
  };
  const nextInspections = inspections.map((i) => {
    if (i.shipId !== ship.id || !i.ruling) return i;
    if (i.ruling.manifestChangedAfter) return i;
    if (i.ruling.basisManifestVersion === manifestVersion) return i;
    return { ...i, ruling: { ...i.ruling, manifestChangedAfter: true } };
  });
  return { ship: nextShip, inspections: nextInspections };
}

/**
 * 裁定落地：依据快照存档，结论整船从头重推（与从头重算完全一致），
 * 裁定按落地时刻先后依次生效。
 */
export function adjudicate(
  ship: Ship,
  inspection: Inspection,
  decisions: Record<string, RulingAction>,
  schedule: TariffSchedule,
  note: string,
  at: number,
): { ship: Ship; inspection: Inspection } {
  const manifest = applyRulingToManifest(ship.manifest, inspection, decisions);
  const conclusionAfter = buildConclusion(ship.origin, manifest, schedule, at);
  const ruling: Ruling = {
    id: `ruling-${inspection.id}`,
    adjudicatedAt: at,
    decisions: Object.entries(decisions).map(([findingId, action]) => ({ findingId, action })),
    basisManifest: ship.manifest.map((e) => ({ ...e })),
    basisManifestVersion: ship.manifestVersion,
    conclusionBefore: ship.conclusion,
    conclusionAfter,
    manifestChangedAfter: false,
    note,
  };
  return {
    ship: { ...ship, manifest, conclusion: conclusionAfter },
    inspection: { ...inspection, status: 'adjudicated', ruling },
  };
}
