/**
 * 离线领域核验：npm run verify:domain
 * 覆盖：种子数据一致性、抽检守卫、裁定重推与从头重算一致、
 * 冲突双方留档、货单后改标记、多轮裁定追溯、船间隔离。
 */
import { buildConclusion, diffConclusions } from '../src/domain/clearance';
import {
  canEditManifest,
  canEditSchedule,
  canInitiateInspection,
  markFindingConflict,
} from '../src/domain/inspection';
import { adjudicate, applyExternalManifestEdit } from '../src/domain/operations';
import { buildSeed } from '../src/domain/seed';
import { verifyAll } from '../src/domain/verify';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const NOW = Date.UTC(2026, 9, 6, 8);

console.log('一、种子数据批量核验');
{
  const { ships, inspections, schedule } = buildSeed();
  const reports = verifyAll(ships, inspections, schedule, NOW);
  for (const r of reports) {
    check(`${r.shipName} 核验通过${r.frozen ? '（结论冻结）' : ''}`, r.ok, r.diffs.join('；'));
  }
}

console.log('二、抽检守卫');
{
  const { ships, inspections } = buildSeed();
  const pending = ships.find((s) => s.id === 'ship-songfeng')!;
  check('待裁定期间不得再次发起抽检', !canInitiateInspection(inspections, pending.id).ok);
  check('待裁定期间货单封存', !canEditManifest(inspections, pending.id).ok);
  check('存在待裁定抽检时关税口径冻结', !canEditSchedule(inspections).ok);
  const clear = ships.find((s) => s.id === 'ship-puluoxin')!;
  check('无抽检商船可发起抽检', canInitiateInspection(inspections, clear.id).ok);
  check('无抽检商船货单可改', canEditManifest(inspections, clear.id).ok);
}

console.log('三、裁定落地：整船重推与从头重算一致、冲突双方留档');
{
  const { ships, inspections, schedule } = buildSeed();
  let ship = ships.find((s) => s.id === 'ship-songfeng')!;
  const insp = inspections.find((i) => i.shipId === ship.id && i.status === 'pending')!;
  const result = adjudicate(
    ship,
    insp,
    { 'f-sf-1': 'adopt-inspection', 'f-sf-2': 'add-entry' },
    schedule,
    '以实点为准，金砂补行登记',
    NOW,
  );
  ship = result.ship;
  const fromScratch = buildConclusion(ship.origin, ship.manifest, schedule, NOW + 1000);
  check(
    '裁定后结论与从头重算一致',
    diffConclusions(ship.conclusion!, fromScratch).length === 0,
    diffConclusions(ship.conclusion!, fromScratch).join('；'),
  );
  const superseded = ship.manifest.find((e) => e.id === 'c-sf-1');
  const adopted = ship.manifest.find((e) => e.id === 'f-sf-1-entry');
  check('被推翻的货单条目留档（superseded）', superseded?.status === 'superseded');
  check('抽检实测条目入册并标来源', adopted?.status === 'active' && adopted.source === 'inspection');
  check('裁定依据快照已存档', result.inspection.ruling!.basisManifest.length > 0);
  check('裁定前结论已存档', result.inspection.ruling!.conclusionBefore !== null);

  console.log('四、裁定后货单外部修正：裁定不被覆盖，标记已变更');
  const edited = applyExternalManifestEdit(
    ship,
    [result.inspection],
    (m) => m.map((e) => (e.id === 'c-sf-3' ? { ...e, quantity: 80 } : e)),
    schedule,
    NOW + 2000,
  );
  const ruling = edited.inspections[0].ruling!;
  check('裁定依据快照未被覆盖', ruling.basisManifest.some((e) => e.id === 'c-sf-3' && e.quantity === 50));
  check('货单已变更标记', ruling.manifestChangedAfter === true);
  check(
    '外部修正后结论仍与从头重算一致',
    diffConclusions(edited.ship.conclusion!, buildConclusion(edited.ship.origin, edited.ship.manifest, schedule, NOW + 3000)).length === 0,
  );
}

console.log('五、多轮裁定：按落地时刻依次生效，前轮可追溯');
{
  const { ships, inspections, schedule } = buildSeed();
  const ship = ships.find((s) => s.id === 'ship-jinzhou')!;
  const ruled = inspections
    .filter((i) => i.shipId === ship.id && i.ruling)
    .sort((a, b) => a.ruling!.adjudicatedAt - b.ruling!.adjudicatedAt);
  check('两轮裁定俱在', ruled.length === 2);
  const [r1, r2] = ruled.map((i) => i.ruling!);
  check('第一轮结论（235 贯）可追溯', r1.conclusionAfter.totalDuty === 235, `实际 ${r1.conclusionAfter.totalDuty}`);
  check('第二轮推翻第一轮（305.4 贯）', r2.conclusionAfter.totalDuty === 305.4, `实际 ${r2.conclusionAfter.totalDuty}`);
  check('第二轮裁定前结论即第一轮裁定后结论', r2.conclusionBefore!.totalDuty === r1.conclusionAfter.totalDuty);
  check('终态结论等于第二轮重推', ship.conclusion!.totalDuty === r2.conclusionAfter.totalDuty);
  const reports = verifyAll([ship], inspections, schedule, NOW);
  check('金洲号整船核验通过', reports[0].ok, reports[0].diffs.join('；'));
}

console.log('六、船间隔离：一船裁定不波及他船');
{
  const { ships, inspections, schedule } = buildSeed();
  const before = ships.find((s) => s.id === 'ship-puluoxin')!.conclusion!;
  const songfeng = ships.find((s) => s.id === 'ship-songfeng')!;
  const insp = inspections.find((i) => i.shipId === songfeng.id)!;
  adjudicate(songfeng, insp, { 'f-sf-1': 'adopt-inspection', 'f-sf-2': 'add-entry' }, schedule, '', NOW);
  const after = ships.find((s) => s.id === 'ship-puluoxin')!.conclusion!;
  check('他船结论不受影响', diffConclusions(before, after).length === 0);
}

console.log('七、冲突登记：双方保留并标记来源');
{
  const { ships } = buildSeed();
  const ship = ships.find((s) => s.id === 'ship-puluoxin')!;
  const manifest = markFindingConflict(ship.manifest, 'c-plx-1');
  const disputed = manifest.find((e) => e.id === 'c-plx-1')!;
  const untouched = manifest.find((e) => e.id === 'c-plx-2')!;
  check('冲突条目标记 disputed 且来源仍为货单', disputed.status === 'disputed' && disputed.source === 'manifest');
  check('无关条目不受影响', untouched.status === 'active');
}

if (failures > 0) {
  console.error(`\n共 ${failures} 项未通过`);
  process.exit(1);
}
console.log('\n全部核验通过');
