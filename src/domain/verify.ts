import { buildConclusion, diffConclusions } from './clearance';
import { pendingInspectionOf } from './inspection';
import type { ClearanceConclusion, Inspection, Ship, TariffSchedule } from './types';

export interface RulingCheck {
  inspectionId: string;
  round: number;
  adjudicatedAt: number;
  ok: boolean;
  issues: string[];
}

export interface ShipVerifyReport {
  shipId: string;
  shipName: string;
  /** 抽检待裁定期间结论冻结，不参与一致性比对 */
  frozen: boolean;
  diffs: string[];
  actual: ClearanceConclusion | null;
  expected: ClearanceConclusion | null;
  rulingChecks: RulingCheck[];
  ok: boolean;
}

/**
 * 单船核验：
 * 1. 以当前货单 + 当前口径从头重算整船结论，与存档结论逐条比对；
 * 2. 逐轮裁定检查依据快照、落地结论、货单变更标记是否完好。
 */
export function verifyShip(
  ship: Ship,
  inspections: Inspection[],
  schedule: TariffSchedule,
  at: number,
): ShipVerifyReport {
  const frozen = pendingInspectionOf(inspections, ship.id) !== null;
  const expected = ship.conclusion && !frozen ? buildConclusion(ship.origin, ship.manifest, schedule, at) : null;
  const diffs = ship.conclusion && expected ? diffConclusions(ship.conclusion, expected) : [];

  const rulingChecks: RulingCheck[] = inspections
    .filter((i) => i.shipId === ship.id && i.ruling)
    .sort((a, b) => a.ruling!.adjudicatedAt - b.ruling!.adjudicatedAt)
    .map((i) => {
      const r = i.ruling!;
      const issues: string[] = [];
      if (!r.basisManifest || r.basisManifest.length === 0) issues.push('缺少裁定依据快照');
      if (!r.conclusionAfter) issues.push('缺少裁定后结论');
      if (r.conclusionBefore && r.conclusionBefore.computedAt > r.adjudicatedAt)
        issues.push('裁定前结论的时刻晚于裁定时刻');
      const changedExpected = ship.manifestVersion !== r.basisManifestVersion;
      if (changedExpected !== r.manifestChangedAfter)
        issues.push(`货单变更标记有误（依据版本 v${r.basisManifestVersion}，当前 v${ship.manifestVersion}）`);
      return { inspectionId: i.id, round: i.round, adjudicatedAt: r.adjudicatedAt, ok: issues.length === 0, issues };
    });

  const ok = diffs.length === 0 && rulingChecks.every((c) => c.ok);
  return { shipId: ship.id, shipName: ship.name, frozen, diffs, actual: ship.conclusion, expected, rulingChecks, ok };
}

/** 统一验证入口：批量核对全部商船的抽检裁定与结论重推 */
export function verifyAll(
  ships: Ship[],
  inspections: Inspection[],
  schedule: TariffSchedule,
  at: number,
): ShipVerifyReport[] {
  return ships.map((s) => verifyShip(s, inspections, schedule, at));
}
