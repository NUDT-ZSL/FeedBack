import { markFindingConflict } from './inspection';
import { adjudicate, applyExternalManifestEdit, recomputeShip } from './operations';
import { DEFAULT_SCHEDULE } from './tariff';
import type { CargoCategory, CargoEntry, CargoSource, CargoStatus, Inspection, Ship, TariffSchedule } from './types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 20, 8); // 2026-09-20 08:00 UTC

function entry(
  id: string,
  name: string,
  category: CargoCategory,
  quantity: number,
  unitValue: number,
  source: CargoSource = 'manifest',
  status: CargoStatus = 'active',
): CargoEntry {
  return { id, name, category, quantity, unitValue, source, status };
}

function makeShip(
  id: string,
  name: string,
  captain: string,
  origin: Ship['origin'],
  tonnage: number,
  arrivedAt: number,
  manifest: CargoEntry[],
): Ship {
  return { id, name, captain, origin, tonnage, arrivedAt, manifest, manifestVersion: 1, conclusion: null };
}

export interface SeedData {
  ships: Ship[];
  inspections: Inspection[];
  schedule: TariffSchedule;
}

/**
 * 示例数据覆盖各边界：
 * - 蒲罗辛号：已验讫，未抽检
 * - 海东青：一轮裁定推翻原结论，裁定后货单又被外部修正
 * - 金洲号：两轮抽检，后一轮裁定推翻前一轮结论，前一轮仍可追溯
 * - 松风丸：抽检待裁定（货单封存中），含一宗冲突、一宗新发现
 * - 沉香号：新入港，尚未验讫
 */
export function buildSeed(): SeedData {
  const schedule = DEFAULT_SCHEDULE;
  const inspections: Inspection[] = [];

  // 1. 蒲罗辛号（大食）
  let ship1 = makeShip('ship-puluoxin', '蒲罗辛号', '蒲罗辛', '大食', 1200, T0, [
    entry('c-plx-1', '乳香', '香料', 50, 12),
    entry('c-plx-2', '龙涎香', '香料', 5, 80),
    entry('c-plx-3', '珍珠', '珠宝', 2, 300),
    entry('c-plx-4', '玻璃器', '瓷器', 100, 3),
  ]);
  ship1 = recomputeShip(ship1, schedule, T0 + 2 * HOUR);

  // 2. 海东青（高丽）：裁定推翻 → 货单外部修正
  let ship2 = makeShip('ship-haidongqing', '海东青', '金彦文', '高丽', 800, T0 + DAY, [
    entry('c-hdq-1', '高丽参', '药材', 30, 20),
    entry('c-hdq-2', '丝绸', '丝绸', 40, 15),
    entry('c-hdq-3', '青瓷', '瓷器', 200, 2),
  ]);
  ship2 = recomputeShip(ship2, schedule, T0 + DAY + 2 * HOUR);
  const insp2: Inspection = {
    id: 'insp-hdq-1',
    shipId: ship2.id,
    round: 1,
    initiatedAt: T0 + 2 * DAY,
    status: 'pending',
    findings: [
      { id: 'f-hdq-1', targetEntryId: 'c-hdq-1', name: '高丽参', category: '药材', quantity: 45, unitValue: 20, note: '舱底夹藏，实点四十五斤' },
    ],
    ruling: null,
  };
  ship2 = { ...ship2, manifest: markFindingConflict(ship2.manifest, 'c-hdq-1') };
  const ruled2 = adjudicate(ship2, insp2, { 'f-hdq-1': 'adopt-inspection' }, schedule, '夹藏属实，以抽检实点为准', T0 + 2 * DAY + 3 * HOUR);
  ship2 = ruled2.ship;
  inspections.push(ruled2.inspection);
  const edited2 = applyExternalManifestEdit(
    ship2,
    inspections,
    (m) => m.map((e) => (e.id === 'c-hdq-2' ? { ...e, quantity: 60 } : e)),
    schedule,
    T0 + 3 * DAY,
  );
  ship2 = edited2.ship;
  inspections.splice(0, inspections.length, ...edited2.inspections);

  // 3. 金洲号（三佛齐）：两轮抽检，后轮推翻前轮
  let ship3 = makeShip('ship-jinzhou', '金洲号', '施连那', '三佛齐', 1500, T0 + 2 * DAY, [
    entry('c-jz-1', '沉香', '香料', 100, 10),
    entry('c-jz-2', '象牙', '珠宝', 10, 50),
    entry('c-jz-3', '粗瓷', '瓷器', 300, 1),
  ]);
  ship3 = recomputeShip(ship3, schedule, T0 + 2 * DAY + 2 * HOUR);
  const insp3a: Inspection = {
    id: 'insp-jz-1',
    shipId: ship3.id,
    round: 1,
    initiatedAt: T0 + 3 * DAY,
    status: 'pending',
    findings: [
      { id: 'f-jz-1', targetEntryId: 'c-jz-1', name: '沉香', category: '香料', quantity: 120, unitValue: 10, note: '舱单少报，实点一百二十斤' },
    ],
    ruling: null,
  };
  ship3 = { ...ship3, manifest: markFindingConflict(ship3.manifest, 'c-jz-1') };
  const ruled3a = adjudicate(ship3, insp3a, { 'f-jz-1': 'adopt-inspection' }, schedule, '以实点为准，补征短报', T0 + 3 * DAY + 4 * HOUR);
  ship3 = ruled3a.ship;
  inspections.push(ruled3a.inspection);
  const insp3b: Inspection = {
    id: 'insp-jz-2',
    shipId: ship3.id,
    round: 2,
    initiatedAt: T0 + 4 * DAY,
    status: 'pending',
    findings: [
      { id: 'f-jz-2', targetEntryId: null, name: '胡椒', category: '香料', quantity: 80, unitValue: 8, note: '暗舱查获未申报胡椒' },
      { id: 'f-jz-3', targetEntryId: 'c-jz-2', name: '象牙', category: '珠宝', quantity: 8, unitValue: 50, note: '抽点短少二支，或为途中损耗' },
    ],
    ruling: null,
  };
  ship3 = { ...ship3, manifest: markFindingConflict(ship3.manifest, 'c-jz-2') };
  const ruled3b = adjudicate(
    ship3,
    insp3b,
    { 'f-jz-2': 'add-entry', 'f-jz-3': 'keep-manifest' },
    schedule,
    '胡椒补行登记；象牙损耗存疑，仍依原单',
    T0 + 4 * DAY + 5 * HOUR,
  );
  ship3 = ruled3b.ship;
  inspections.push(ruled3b.inspection);

  // 4. 松风丸（日本）：抽检待裁定
  let ship4 = makeShip('ship-songfeng', '松风丸', '藤原清', '日本', 600, T0 + 4 * DAY, [
    entry('c-sf-1', '硫黄', '药材', 40, 5),
    entry('c-sf-2', '折扇', '杂货', 500, 0.2),
    entry('c-sf-3', '漆器', '瓷器', 50, 4),
  ]);
  ship4 = recomputeShip(ship4, schedule, T0 + 4 * DAY + 2 * HOUR);
  const insp4: Inspection = {
    id: 'insp-sf-1',
    shipId: ship4.id,
    round: 1,
    initiatedAt: T0 + 5 * DAY,
    status: 'pending',
    findings: [
      { id: 'f-sf-1', targetEntryId: 'c-sf-1', name: '硫黄', category: '药材', quantity: 60, unitValue: 5, note: '实点六十斤，多于舱单' },
      { id: 'f-sf-2', targetEntryId: null, name: '金砂', category: '珠宝', quantity: 3, unitValue: 100, note: '夹层查获未申报金砂' },
    ],
    ruling: null,
  };
  ship4 = { ...ship4, manifest: markFindingConflict(ship4.manifest, 'c-sf-1') };
  inspections.push(insp4);

  // 5. 沉香号（占城）：尚未验讫
  const ship5 = makeShip('ship-chenxiang', '沉香号', '李保', '占城', 900, T0 + 5 * DAY, [
    entry('c-cx-1', '沉香', '香料', 60, 11),
    entry('c-cx-2', '豆蔻', '药材', 80, 3),
  ]);

  return { ships: [ship1, ship2, ship3, ship4, ship5], inspections, schedule };
}
