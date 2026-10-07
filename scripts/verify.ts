import { Casting, computeGrade } from '../src/core/Casting.ts';
import type { CastingStats } from '../src/core/Casting.ts';
import { WorkOrderStore } from '../src/data/WorkOrderStore.ts';

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
}

function approx(a: number, b: number, tolerance: number = 1): boolean {
  return Math.abs(a - b) <= tolerance;
}

function statsSum(stats: CastingStats | undefined): number {
  if (!stats) return 0;
  return stats.hardness + stats.toughness + stats.sharpness;
}

const POUR_DURATION_MS = 3000;

function coolCast(cast: Casting, baseTime: number, extraMs: number = 16000): number {
  cast.beginCooling(baseTime + POUR_DURATION_MS);
  return baseTime + POUR_DURATION_MS + extraMs;
}

// ---------------------------------------------------------------------------
// 场景一：多件并行，各自携带炉温/冷却进度/淬火标记独立流转，互不串扰
// ---------------------------------------------------------------------------
const t0 = 1_000_000;
const castA = new Casting('cast-A', 'sword', 1500);
const castB = new Casting('cast-B', 'ding', 1300);

const aCoolStart = t0 + POUR_DURATION_MS;
castA.beginCooling(aCoolStart);

const midTime = t0 + 5000;
const tempA = castA.getTemperature(midTime);
check(
  '并行-浇铸后A温度按自身曲线下降',
  tempA < 1500 && tempA > 100,
  `A@5s=${tempA.toFixed(1)}°C`
);
check(
  '并行-B尚未开始冷却，保持自身浇铸炉温且不受A影响',
  castB.getTemperature(midTime) === 1300 && approx(castB.getCoolingProgress(midTime), 0),
  `B@5s=${castB.getTemperature(midTime)}°C`
);
check(
  '并行-A自身冷却进度随时间增长',
  castA.getCoolingProgress(midTime) > 0.2 && castA.getCoolingProgress(midTime) < 0.9,
  `A进度=${castA.getCoolingProgress(midTime).toFixed(2)}`
);

const aReady = aCoolStart + 16000;
check('并行-A在约19s时冷却完成', castA.isCooled(aReady));
check('并行-B未开始冷却，仍未冷却完成', !castB.isCooled(aReady));

const quenchA = castA.quench(aReady);
check('并行-A冷却完成后可淬火', quenchA.ok);
check('并行-A淬火后B的淬火标记仍为false', castA.isQuenched() && !castB.isQuenched());

const bCoolStart = t0 + 9000 + POUR_DURATION_MS;
castB.beginCooling(bCoolStart);
const bReady = bCoolStart + 16000;
check('并行-B按自己的时间轴独立冷却完成', castB.isCooled(bReady));
const quenchB = castB.quench(bReady);
check('并行-B可独立淬火，不影响A的淬火状态', quenchB.ok && castA.isQuenched());

// ---------------------------------------------------------------------------
// 场景二：未冷却送检必须被拒绝
// ---------------------------------------------------------------------------
const castC = new Casting('cast-C', 'plow', 1600);
castC.beginCooling(t0 + POUR_DURATION_MS);
const earlyInspection = castC.inspect(t0 + 5000);
check('未冷却-送检被拒绝', !earlyInspection.ok);
check(
  '未冷却-拒绝原因可见（提示冷却）',
  !earlyInspection.ok && earlyInspection.reason.includes('冷却'),
  !earlyInspection.ok ? earlyInspection.reason : ''
);
check('未冷却-铸件未被标记为已质检', !castC.isInspected());

const earlyQuench = castC.quench(t0 + 5000);
check('未冷却-提前淬火同样被拒绝', !earlyQuench.ok && earlyQuench.reason.includes('冷却'));

// ---------------------------------------------------------------------------
// 场景三：未淬火送检必须被拒绝
// ---------------------------------------------------------------------------
const cReady = coolCast(castC, t0);
check('未淬火-冷却后阶段为cooled而非quenched', castC.getStage(cReady) === 'cooled');
const noQuenchInspection = castC.inspect(cReady);
check('未淬火-送检被拒绝', !noQuenchInspection.ok);
check(
  '未淬火-拒绝原因可见（提示淬火）',
  !noQuenchInspection.ok && noQuenchInspection.reason.includes('淬火'),
  !noQuenchInspection.ok ? noQuenchInspection.reason : ''
);

// ---------------------------------------------------------------------------
// 场景四：合格流程 + 质检指标按铸件自身状态独立计算 + 重复质检拒绝
// ---------------------------------------------------------------------------
const inspectA = castA.inspect(aReady);
check('正常-A冷却且淬火后允许质检', inspectA.ok && !!inspectA.stats);
const statsA = inspectA.stats;

const inspectB = castB.inspect(bReady);
check('正常-B冷却且淬火后允许质检', inspectB.ok && !!inspectB.stats);
const statsB = inspectB.stats;

if (statsA && statsB) {
  const different = statsA.hardness !== statsB.hardness
    || statsA.toughness !== statsB.toughness
    || statsA.sharpness !== statsB.sharpness;
  check('指标独立-A与B炉温/编号不同，三项指标互不相同', different);
  check(
    '指标独立-所有指标均在0-100范围内',
    [statsA.hardness, statsA.toughness, statsA.sharpness, statsB.hardness, statsB.toughness, statsB.sharpness]
      .every(v => v >= 0 && v <= 100)
  );
  check('指标稳定-同一铸件重复读取指标保持一致', JSON.stringify(castA.getStats()) === JSON.stringify(statsA));
}

const repeatInspection = castA.inspect(aReady);
check('重复质检-再次送检被拒绝', !repeatInspection.ok);
check(
  '重复质检-拒绝原因可见（提示重复）',
  !repeatInspection.ok && repeatInspection.reason.includes('重复'),
  !repeatInspection.ok ? repeatInspection.reason : ''
);
check('重复质检-铸件质检状态只翻转一次', castA.isInspected());

// ---------------------------------------------------------------------------
// 场景五：工单记录与各铸件真实状态一致，且按 castingId 去重
// ---------------------------------------------------------------------------
const store = new WorkOrderStore();
if (statsA) {
  const recordA1 = store.addRecord({
    castingId: castA.id,
    productType: castA.moldType,
    hardness: statsA.hardness,
    toughness: statsA.toughness,
    sharpness: statsA.sharpness
  });
  const recordA2 = store.addRecord({
    castingId: castA.id,
    productType: castA.moldType,
    hardness: statsA.hardness,
    toughness: statsA.toughness,
    sharpness: statsA.sharpness
  });
  check('工单去重-同一铸件重复提交不产生新记录', store.getRecords().length === 1);
  check('工单去重-返回同一条记录', recordA1 === recordA2);
  check('工单去重-hasRecordFor正确识别', store.hasRecordFor(castA.id) && !store.hasRecordFor('cast-NOPE'));
  check(
    '工单一致性-记录品级等于三项之和对应品级',
    recordA1.grade === computeGrade(statsSum(statsA)),
    `品级=${recordA1.grade}`
  );
  check('工单一致性-记录的指标与铸件自身指标一致', recordA1.hardness === statsA.hardness
    && recordA1.toughness === statsA.toughness
    && recordA1.sharpness === statsA.sharpness);
}

if (statsB) {
  store.addRecord({
    castingId: castB.id,
    productType: castB.moldType,
    hardness: statsB.hardness,
    toughness: statsB.toughness,
    sharpness: statsB.sharpness
  });
}
const records = store.getRecords();
check('工单顺序-最新记录排在最前', records[0].castingId === castB.id);
check('工单顺序-多件各占一条且互不串扰', records.length === 2 && records[1].castingId === castA.id);
if (statsB) {
  const recB = records[0];
  check(
    '工单一致性-B记录品级/指标等于B自身状态',
    recB.grade === computeGrade(statsSum(statsB))
      && recB.hardness === statsB.hardness
      && recB.toughness === statsB.toughness
      && recB.sharpness === statsB.sharpness
      && recB.productType === 'ding'
  );
}

const castCQuench = castC.quench(cReady);
check('未淬火铸件补齐淬火后可正常质检', castCQuench.ok && castC.inspect(cReady).ok);

// ---------------------------------------------------------------------------
// 场景六：品级阈值边界
// ---------------------------------------------------------------------------
check('品级阈值-241为上品', computeGrade(241) === '上品');
check('品级阈值-240为良品', computeGrade(240) === '良品');
check('品级阈值-201为良品', computeGrade(201) === '良品');
check('品级阈值-200为次品', computeGrade(200) === '次品');

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
let passedCount = 0;
for (const result of results) {
  const status = result.passed ? 'PASS' : 'FAIL';
  const detail = result.detail ? ` (${result.detail})` : '';
  console.log(`[${status}] ${result.name}${detail}`);
  if (result.passed) passedCount += 1;
}

console.log(`\n验证结果：${passedCount}/${results.length} 通过`);
if (passedCount !== results.length) {
  process.exit(1);
}
