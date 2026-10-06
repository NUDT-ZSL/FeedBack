import type {
  CargoCategory,
  ClearanceConclusion,
  ClearanceDecision,
  ConclusionLine,
  Inspection,
  Ship,
  TariffRule,
} from './types';

export const round2 = (n: number) => Math.round(n * 100) / 100;

// 税率解析：船籍+类别 精确匹配 > 船籍通例 > 类别通例 > 全局默认
export function resolveRate(
  rules: TariffRule[],
  registry: string,
  category: CargoCategory,
): number {
  const exact = rules.find((r) => r.registry === registry && r.category === category);
  if (exact) return exact.rate;
  const byRegistry = rules.find((r) => r.registry === registry && r.category === '*');
  if (byRegistry) return byRegistry.rate;
  const byCategory = rules.find((r) => r.registry === '*' && r.category === category);
  if (byCategory) return byCategory.rate;
  const fallback = rules.find((r) => r.registry === '*' && r.category === '*');
  return fallback ? fallback.rate : 0.1;
}

export function adjudicatedOf(ship: Ship): Inspection[] {
  return ship.inspections
    .filter((i) => i.status === 'adjudicated')
    .sort((a, b) => (a.adjudicatedAt ?? 0) - (b.adjudicatedAt ?? 0) || a.seq - b.seq);
}

export function pendingOf(ship: Ship): Inspection | null {
  return ship.inspections.find((i) => i.status === 'pending') ?? null;
}

// 裁定落地后货单是否又被外部修正
export function isInspectionStale(inspection: Inspection, ship: Ship): boolean {
  return (
    inspection.status === 'adjudicated' &&
    inspection.manifestVersionAtAdjudication !== null &&
    ship.manifestVersion > inspection.manifestVersionAtAdjudication
  );
}

export function shipStaleInspections(ship: Ship): Inspection[] {
  return ship.inspections.filter((i) => isInspectionStale(i, ship));
}

/**
 * 全量重推：从当前货单出发，按裁定时刻先后依次应用每轮抽检裁定，
 * 得到整船通关结论。任何局部变更都必须经由本函数重算，保证与从头重算一致。
 */
export function recompute(ship: Ship, rules: TariffRule[]): ClearanceConclusion {
  const lines: ConclusionLine[] = ship.manifest.map((item) => ({
    key: `cargo:${item.id}`,
    cargoItemId: item.id,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    rate: 0,
    tax: 0,
    source: 'manifest',
    declared: null,
    rulingInspectionId: null,
    conflicts: [],
  }));

  let rulingCount = 0;
  for (const inspection of adjudicatedOf(ship)) {
    for (const finding of inspection.findings) {
      rulingCount += 1;
      if (finding.kind === 'new_item') {
        lines.push({
          key: `ruling:${finding.id}`,
          cargoItemId: null,
          name: finding.observed.name,
          category: finding.observed.category,
          quantity: finding.observed.quantity,
          unitPrice: finding.observed.unitPrice,
          rate: 0,
          tax: 0,
          source: 'ruling',
          declared: null,
          rulingInspectionId: inspection.id,
          conflicts: [],
        });
        continue;
      }
      const line = lines.find((l) => l.cargoItemId === finding.cargoItemId);
      if (!line) {
        // 货单条目在裁定后被删除：裁定依据保留在抽检记录中，此处仅标记
        continue;
      }
      const manifestItem = ship.manifest.find((m) => m.id === finding.cargoItemId)!;
      const conflicts: string[] = [...line.conflicts];
      if (
        finding.declared &&
        (manifestItem.quantity !== finding.declared.quantity ||
          manifestItem.category !== finding.declared.category ||
          manifestItem.unitPrice !== finding.declared.unitPrice ||
          manifestItem.name !== finding.declared.name)
      ) {
        conflicts.push('货单已于裁定后变更，裁定依据为当时货单快照');
      }
      if (
        manifestItem.quantity !== finding.observed.quantity ||
        manifestItem.category !== finding.observed.category
      ) {
        conflicts.push('货单记录与抽检裁定不一致，按裁定计征');
      }
      lines[lines.indexOf(line)] = {
        ...line,
        name: finding.observed.name,
        category: finding.observed.category,
        quantity: finding.observed.quantity,
        unitPrice: finding.observed.unitPrice,
        source: 'ruling',
        declared: { ...manifestItem },
        rulingInspectionId: inspection.id,
        conflicts,
      };
    }
  }

  for (const line of lines) {
    line.rate = resolveRate(rules, ship.registry, line.category);
    line.tax = round2(line.quantity * line.unitPrice * line.rate);
  }

  const totalTax = round2(lines.reduce((sum, l) => sum + l.tax, 0));
  const reasons: string[] = [];
  let decision: ClearanceDecision = 'pass';

  const pending = pendingOf(ship);
  if (pending) {
    decision = 'hold';
    reasons.push(`第 ${pending.seq} 轮抽检待裁定，暂缓放行`);
  }
  const stale = shipStaleInspections(ship);
  if (stale.length > 0) {
    if (decision === 'pass') decision = 'review';
    reasons.push(
      `第 ${stale.map((s) => s.seq).join('、')} 轮裁定落地后货单已变更，需复核`,
    );
  }
  const conflictLines = lines.filter((l) => l.conflicts.length > 0);
  if (conflictLines.length > 0 && decision === 'pass') {
    decision = 'review';
    reasons.push('存在货单与裁定冲突的条目，需复核');
  }
  if (decision === 'pass') reasons.push('验讫，准予放行');

  return {
    manifestVersion: ship.manifestVersion,
    rulingCount,
    lines,
    totalTax,
    decision,
    reasons,
  };
}
