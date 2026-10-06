import type { ClearanceConclusion, Finding, Ship, TariffRule } from './types';
import { adjudicatedOf, pendingOf, recompute, shipStaleInspections } from './recompute';
import { adjudicate, applyManifestEdit, genId, initiateInspection } from './operations';

export interface CheckResult {
  id: string;
  group: string;
  title: string;
  pass: boolean;
  detail: string;
}

const strip = (c: ClearanceConclusion) => JSON.stringify(c);

export function conclusionConsistent(ship: Ship, rules: TariffRule[]): boolean {
  return strip(ship.conclusion) === strip(recompute(ship, rules));
}

// 单船核验：存储结论与全量重推一致、锁定约束、裁定链有序
export function verifyShip(ship: Ship, rules: TariffRule[]): CheckResult[] {
  const results: CheckResult[] = [];
  const gid = `ship:${ship.id}`;

  const consistent = conclusionConsistent(ship, rules);
  results.push({
    id: `${gid}:recompute`,
    group: ship.name,
    title: '结论重推一致',
    pass: consistent,
    detail: consistent
      ? `存储结论与从头重算一致（货单 v${ship.manifestVersion}，${ship.conclusion.rulingCount} 条裁定，税银 ${ship.conclusion.totalTax} 两）`
      : '存储结论与从头重算不一致，存在局部脏数据',
  });

  const pending = pendingOf(ship);
  const lockOk = !pending || pending.basisManifestVersion === ship.manifestVersion;
  results.push({
    id: `${gid}:lock`,
    group: ship.name,
    title: '待裁定期间货单未变更',
    pass: lockOk,
    detail: pending
      ? lockOk
        ? `第 ${pending.seq} 轮抽检待裁定，货单版本保持 v${pending.basisManifestVersion}`
        : '抽检待裁定期间货单被修改，违反锁定约束'
      : '无待裁定抽检',
  });

  const chain = adjudicatedOf(ship);
  const ordered = chain.every(
    (c, i) => i === 0 || (chain[i - 1].adjudicatedAt ?? 0) <= (c.adjudicatedAt ?? 0),
  );
  const traceable = chain.every(
    (c) => c.conclusionBefore !== null && c.conclusionAfter !== null,
  );
  results.push({
    id: `${gid}:chain`,
    group: ship.name,
    title: '裁定链有序且可追溯',
    pass: ordered && traceable,
    detail:
      chain.length === 0
        ? '无已落地裁定'
        : ordered && traceable
          ? `${chain.length} 轮裁定按时刻依次生效，前后结论快照完整`
          : '裁定顺序或快照缺失',
  });

  const stale = shipStaleInspections(ship);
  results.push({
    id: `${gid}:stale`,
    group: ship.name,
    title: '货单变更标记',
    pass: true,
    detail:
      stale.length > 0
        ? `第 ${stale.map((s) => s.seq).join('、')} 轮裁定落地后货单已变更，已标记需复核`
        : '无裁定后货单变更',
  });

  return results;
}

export function verifyAll(ships: Ship[], rules: TariffRule[]): CheckResult[] {
  return ships.flatMap((s) => verifyShip(s, rules));
}

// ---------- 场景核验（内存构造，不触碰在港数据） ----------

function makeShip(id: string, registry: string): Ship {
  const ship: Ship = {
    id,
    name: `场景船·${id}`,
    registry,
    captain: '场景',
    origin: '场景',
    arrivedAt: 0,
    manifest: [
      { id: `${id}-c1`, name: '乳香', category: '细色', quantity: 100, unitPrice: 2 },
      { id: `${id}-c2`, name: '瓷器', category: '粗色', quantity: 50, unitPrice: 1 },
    ],
    manifestVersion: 1,
    inspections: [],
    conclusion: undefined as unknown as ClearanceConclusion,
  };
  return { ...ship, conclusion: recompute(ship, SCENARIO_RULES) };
}

const SCENARIO_RULES: TariffRule[] = [
  { id: 'sr1', registry: '*', category: '细色', rate: 0.1 },
  { id: 'sr2', registry: '*', category: '粗色', rate: 0.15 },
];

function finding(partial: Partial<Finding> & Pick<Finding, 'kind' | 'observed'>): Finding {
  return {
    id: genId('fnd'),
    cargoItemId: null,
    declared: null,
    ...partial,
  };
}

export function runScenarios(): CheckResult[] {
  const results: CheckResult[] = [];
  const push = (id: string, title: string, pass: boolean, detail: string) =>
    results.push({ id, group: '边界场景', title, pass, detail });

  // 场景一：抽检与货单冲突，双方保留并标记来源
  {
    let ship = makeShip('s1', '大食');
    ship = initiateInspection(ship, SCENARIO_RULES, 1).ship!;
    const declared = ship.manifest[0];
    ship = adjudicate(
      ship,
      ship.inspections[0].id,
      [
        finding({
          kind: 'quantity',
          cargoItemId: declared.id,
          declared: { ...declared },
          observed: { ...declared, quantity: 160 },
        }),
      ],
      SCENARIO_RULES,
      2,
    ).ship!;
    const line = ship.conclusion.lines.find((l) => l.cargoItemId === declared.id)!;
    const kept =
      line.source === 'ruling' &&
      line.declared !== null &&
      line.declared.quantity === 100 &&
      line.quantity === 160 &&
      line.conflicts.length > 0;
    push(
      'sc1',
      '冲突双方保留并标记来源',
      kept && conclusionConsistent(ship, SCENARIO_RULES),
      kept
        ? '货单原值 100 与裁定值 160 并存，结论按裁定计征且重推一致'
        : '冲突双方未被完整保留',
    );
  }

  // 场景二：抽检仅作补充记录（新增货物）
  {
    let ship = makeShip('s2', '高丽');
    ship = initiateInspection(ship, SCENARIO_RULES, 1).ship!;
    ship = adjudicate(
      ship,
      ship.inspections[0].id,
      [
        finding({
          kind: 'new_item',
          observed: { id: 's2-new', name: '未申报珍珠', category: '细色', quantity: 10, unitPrice: 5 },
        }),
      ],
      SCENARIO_RULES,
      2,
    ).ship!;
    const added = ship.conclusion.lines.some(
      (l) => l.source === 'ruling' && l.name === '未申报珍珠',
    );
    push(
      'sc2',
      '补充记录并入结论',
      added && ship.conclusion.lines.length === 3 && conclusionConsistent(ship, SCENARIO_RULES),
      added ? '补充货物以裁定来源入册，全船结论重推一致' : '补充记录未正确并入',
    );
  }

  // 场景三：裁定后货单被外部修正，裁定不被覆盖并标记
  {
    let ship = makeShip('s3', '三佛齐');
    ship = initiateInspection(ship, SCENARIO_RULES, 1).ship!;
    const declared = ship.manifest[0];
    ship = adjudicate(
      ship,
      ship.inspections[0].id,
      [
        finding({
          kind: 'quantity',
          cargoItemId: declared.id,
          declared: { ...declared },
          observed: { ...declared, quantity: 160 },
        }),
      ],
      SCENARIO_RULES,
      2,
    ).ship!;
    ship = applyManifestEdit(
      ship,
      (m) => m.map((it) => (it.id === declared.id ? { ...it, quantity: 120 } : it)),
      SCENARIO_RULES,
    ).ship!;
    const line = ship.conclusion.lines.find((l) => l.cargoItemId === declared.id)!;
    const rulingKept = line.quantity === 160 && line.declared?.quantity === 120;
    const marked =
      shipStaleInspections(ship).length === 1 && ship.conclusion.decision === 'review';
    push(
      'sc3',
      '裁定后货单变更不覆盖裁定',
      rulingKept && marked && conclusionConsistent(ship, SCENARIO_RULES),
      rulingKept && marked
        ? '货单改为 120 后裁定值 160 仍生效，裁定依据保留并标记货单已变更'
        : '裁定被覆盖或未标记',
    );
  }

  // 场景四：多轮抽检按时刻依次生效，前轮可追溯
  {
    let ship = makeShip('s4', '日本');
    ship = initiateInspection(ship, SCENARIO_RULES, 10).ship!;
    const declared = ship.manifest[0];
    ship = adjudicate(
      ship,
      ship.inspections[0].id,
      [
        finding({
          kind: 'quantity',
          cargoItemId: declared.id,
          declared: { ...declared },
          observed: { ...declared, quantity: 160 },
        }),
      ],
      SCENARIO_RULES,
      20,
    ).ship!;
    ship = initiateInspection(ship, SCENARIO_RULES, 30).ship!;
    const current = ship.conclusion.lines.find((l) => l.cargoItemId === declared.id)!;
    ship = adjudicate(
      ship,
      ship.inspections[1].id,
      [
        finding({
          kind: 'quantity',
          cargoItemId: declared.id,
          declared: { ...ship.manifest[0] },
          observed: { ...ship.manifest[0], quantity: 200 },
        }),
      ],
      SCENARIO_RULES,
      40,
    ).ship!;
    const final = ship.conclusion.lines.find((l) => l.cargoItemId === declared.id)!;
    const first = ship.inspections[0];
    const traceable =
      first.conclusionAfter !== null &&
      first.conclusionAfter.lines.find((l) => l.cargoItemId === declared.id)?.quantity === 160;
    void current;
    push(
      'sc4',
      '多轮裁定依次生效且可追溯',
      final.quantity === 200 && traceable && conclusionConsistent(ship, SCENARIO_RULES),
      final.quantity === 200 && traceable
        ? '第二轮裁定（200）推翻第一轮（160），第一轮前后结论快照仍可追溯'
        : '多轮裁定顺序或追溯异常',
    );
  }

  // 场景五：裁定只影响本船
  {
    let a = makeShip('s5a', '大食');
    let b = makeShip('s5b', '大食');
    const before = strip(b.conclusion);
    a = initiateInspection(a, SCENARIO_RULES, 1).ship!;
    a = adjudicate(
      a,
      a.inspections[0].id,
      [
        finding({
          kind: 'quantity',
          cargoItemId: a.manifest[0].id,
          declared: { ...a.manifest[0] },
          observed: { ...a.manifest[0], quantity: 999 },
        }),
      ],
      SCENARIO_RULES,
      2,
    ).ship!;
    b = { ...b, conclusion: recompute(b, SCENARIO_RULES) };
    const isolated = strip(b.conclusion) === before;
    const aChanged = a.conclusion.totalTax !== 0 && a.conclusion.lines.some((l) => l.quantity === 999);
    push(
      'sc5',
      '裁定不影响其他商船',
      isolated && aChanged,
      isolated && aChanged
        ? '甲船裁定正常生效，乙船结论逐字节不变'
        : '裁定波及其他商船或未在本船生效',
    );
  }

  // 场景六：待裁定期间锁定货单
  {
    let ship = makeShip('s6', '占城');
    ship = initiateInspection(ship, SCENARIO_RULES, 1).ship!;
    const edit = applyManifestEdit(ship, (m) => m.slice(1), SCENARIO_RULES);
    const again = initiateInspection(ship, SCENARIO_RULES, 2);
    push(
      'sc6',
      '待裁定期间锁定货单与重复发起',
      !!edit.error && !!again.error,
      edit.error && again.error
        ? `货单修改被拒（${edit.error}）；重复发起被拒（${again.error}）`
        : '锁定约束未生效',
    );
  }

  return results;
}
