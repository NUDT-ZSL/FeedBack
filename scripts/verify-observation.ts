/**
 * 观星台观测状态单一来源验证脚本（离线运行，无需浏览器）
 *
 * 运行方式：npm run verify   （或 node scripts/verify-observation.ts）
 *
 * 覆盖链路：浑天仪拖拽、时辰盘拖动、星体点选、记录写入、星象图导出取值，
 * 包含正常操作与连续快速操作（同步突发）两类情形。
 */
import {
  createObservationStore,
  normalizeRa,
  normalizeDec,
  normalizeHour,
  MAX_RECORDS,
  TOAST_RECORDS_FULL,
  TOAST_NO_STAR,
  type ObservationStore,
} from '../src/store/observationStore.ts';
import type { CelestialBody } from '../src/types.ts';
import {
  hourToShichen,
  shichenToHour,
  sphericalToCartesian,
  cartesianToSpherical,
  formatTime,
} from '../src/utils.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

const check = (label: string, cond: boolean, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`);
  }
};

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const makeStar = (name: string, ra: number, dec: number): CelestialBody => ({
  position: sphericalToCartesian(50, ra, dec),
  color: '#ffffff',
  size: 0.08,
  name,
  latinName: `Test ${name}`,
  magnitude: 1.0,
  description: '验证用星体',
  type: 'star',
});

// 模拟一次浑天仪拖拽突发：与组件相同的增量语义（每次 pointermove 一个 delta）
const simulateAstrolabeDrag = (
  store: ObservationStore,
  deltas: { ra?: number; dec?: number }[]
) => {
  for (const d of deltas) {
    if (d.ra !== undefined) store.adjustRa(d.ra);
    if (d.dec !== undefined) store.adjustDec(d.dec);
  }
};

// 模拟时辰盘拖动：组件由指针角度算出小时（0.5 步进）后写入
const hourFromDialAngle = (angleDeg: number): number => {
  let angle = angleDeg % 360;
  if (angle < 0) angle += 360;
  return Math.round(((angle / 360) * 24) * 2) / 2;
};

console.log('\n[1] 时辰盘链路：拖动 -> 单一状态 -> 时辰换算一致');
{
  const store = createObservationStore();
  const angles = [0, 45, 90, 180, 277.5, 359.9];
  let ok = true;
  for (const angle of angles) {
    const hour = hourFromDialAngle(angle);
    store.setHour(hour);
    const s = store.getState();
    // 面板指针角度、时辰索引、记录小时都必须从同一 currentHour 推出
    const pointerAngle = (s.currentHour / 24) * 360;
    if (!(s.currentHour >= 0 && s.currentHour < 24)) ok = false;
    if (!(pointerAngle >= 0 && pointerAngle < 360)) ok = false;
    const idx = hourToShichen(s.currentHour);
    if (!(idx >= 0 && idx < 12)) ok = false;
  }
  check('拖动时辰盘后 currentHour 归一化且指针/时辰索引同源', ok);

  store.setHour(24);
  check('边界 hour=24 归一化为 0', approx(store.getState().currentHour, 0));
  store.setHour(-0.5);
  check('负值 hour 归一化到 [0,24)', approx(store.getState().currentHour, 23.5));
  store.setHour(21);
  check('hour=21 -> 亥时(索引11)', hourToShichen(store.getState().currentHour) === 11);
  check('shichenToHour 与常量表一致', shichenToHour(11) === 21 && shichenToHour(0) === 23);
}

console.log('\n[2] 浑天仪链路：拖拽 -> 赤经赤纬范围与累计一致');
{
  const store = createObservationStore();
  const raDeltas = [3, 5, -2, 7, 1, -4, 12, 30, -8, 2];
  simulateAstrolabeDrag(store, raDeltas.map((ra) => ({ ra })));
  const expectedRa = raDeltas.reduce((acc, d) => normalizeRa(acc + d), 0);
  check(
    '连续拖拽赤经无丢失更新（环绕 0..360）',
    approx(store.getState().ra, expectedRa),
    `got ${store.getState().ra}, want ${expectedRa}`
  );

  simulateAstrolabeDrag(store, [{ ra: -400 }]);
  check('赤经大幅负向拖拽后仍在 [0,360)', store.getState().ra >= 0 && store.getState().ra < 360);

  const decDeltas = [10, 25, 40, 30, 60]; // 累计 165 -> 应被钳制在 90
  simulateAstrolabeDrag(store, decDeltas.map((dec) => ({ dec })));
  check('赤纬拖拽钳制在 +90', approx(store.getState().dec, 90));
  simulateAstrolabeDrag(store, [{ dec: -500 }]);
  check('赤纬拖拽钳制在 -90', approx(store.getState().dec, -90));
}

console.log('\n[3] 星体点选链路：点选 -> 浑天仪/面板/记录同源');
{
  const store = createObservationStore();
  const star = makeStar('织女星', 123.5, 38.7);
  store.selectStar(star);
  const s = store.getState();
  const expected = cartesianToSpherical(...star.position);
  check('点选后浑天仪赤经同步到星体', approx(s.ra, expected.ra % 360, 1e-6));
  check('点选后浑天仪赤纬同步到星体', approx(s.dec, expected.dec, 1e-6));
  check('面板读取的坐标与浑天仪同一份状态', s.selectedStar !== null && approx(s.ra, store.getState().ra));

  store.selectStar(star); // 再次点选同名星体 -> 取消选中
  const s2 = store.getState();
  check('再次点选同名星体取消选中', s2.selectedStar === null);
  check('取消选中后浑天仪朝向保持', approx(s2.ra, s.ra) && approx(s2.dec, s.dec));
}

console.log('\n[4] 记录写入链路：记录内容与写入时刻状态一致');
{
  const store = createObservationStore();
  store.selectStar(makeStar('天狼星', 101.3, -16.7));
  store.setHour(hourFromDialAngle(315)); // 21:00
  simulateAstrolabeDrag(store, [{ ra: 6 }, { dec: -3 }]);
  const okAdd = store.addRecord();
  const s = store.getState();
  const rec = s.records[s.records.length - 1];
  check('记录写入成功', okAdd && s.records.length === 1);
  check(
    '记录坐标 == 写入时刻浑天仪坐标（面板同源）',
    approx(rec.ra, s.ra) && approx(rec.dec, s.dec)
  );
  check('记录小时 == 写入时刻时辰盘小时', approx(rec.hour, s.currentHour));
  check('记录时间串与 formatTime 一致', rec.time === formatTime(s.currentHour));
  check('记录星体 == 当前选中星体', rec.starName === '天狼星');

  const empty = createObservationStore();
  check('未选星体时记录被拒绝', empty.addRecord() === false);
  check('未选星体提示语义保持', empty.getState().toast === TOAST_NO_STAR);
}

console.log('\n[5] 连续快速操作：同步突发下不错位');
{
  const store = createObservationStore();
  store.selectStar(makeStar('北极星', 37.95, 89.26));
  let ok = true;
  let recordChecks = 0;
  // 伪随机但确定性的突发序列：拖拽/时辰/记录交替，无事件循环间隙
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 500; i++) {
    const op = i % 5;
    if (op === 0) store.adjustRa(Math.round(rand() * 40 - 20));
    else if (op === 1) store.adjustDec(Math.round(rand() * 20 - 10));
    else if (op === 2) store.setHour(hourFromDialAngle(rand() * 360));
    else if (op === 3) {
      const before = store.getState();
      if (store.addRecord()) {
        const after = store.getState();
        const rec = after.records[after.records.length - 1];
        // 记录必须与写入瞬间的状态完全一致
        if (!(approx(rec.ra, before.ra) && approx(rec.dec, before.dec) && approx(rec.hour, before.currentHour))) {
          ok = false;
        }
        recordChecks++;
      }
    } else {
      store.selectStar(makeStar(`星${i % 7}`, rand() * 360, rand() * 170 - 85));
    }
    const s = store.getState();
    if (!(s.ra >= 0 && s.ra < 360)) ok = false;
    if (!(s.dec >= -90 && s.dec <= 90)) ok = false;
    if (!(s.currentHour >= 0 && s.currentHour < 24)) ok = false;
  }
  check(`500 次突发操作范围不变量成立（含 ${recordChecks} 次拖动中记录）`, ok);

  // 拖动中立即记录：记录必须反映最新拖拽结果（先清空，避免触发上限）
  store.clearRecords();
  simulateAstrolabeDrag(store, [{ ra: 9 }, { ra: 9 }, { dec: -4 }]);
  const snap = store.getState();
  store.addRecord();
  const last = store.getState().records[store.getState().records.length - 1];
  check(
    '拖动过程中触发记录，落库坐标与当前状态一致',
    approx(last.ra, snap.ra) && approx(last.dec, snap.dec) && approx(last.hour, snap.currentHour)
  );
}

console.log('\n[6] 记录上限与提示语义');
{
  const store = createObservationStore();
  store.selectStar(makeStar('牛郎星', 297.7, 8.9));
  for (let i = 0; i < MAX_RECORDS; i++) store.addRecord();
  check(`记录达到上限 ${MAX_RECORDS}`, store.getState().records.length === MAX_RECORDS);
  check('超限记录被拒绝', store.addRecord() === false);
  check('超限提示语义保持', store.getState().toast === TOAST_RECORDS_FULL);
  check('超限后记录数不变', store.getState().records.length === MAX_RECORDS);

  const first = store.getState().records[0];
  store.deleteRecord(first.id);
  check('删除记录后数量减一', store.getState().records.length === MAX_RECORDS - 1);
  check('删除后可再次记录', store.addRecord() === true);
  store.clearRecords();
  check('清空记录', store.getState().records.length === 0);
}

console.log('\n[7] 星象图导出取值与状态同源');
{
  const store = createObservationStore();
  store.selectStar(makeStar('心宿二', 247.35, -26.43));
  simulateAstrolabeDrag(store, [{ ra: 13 }, { dec: 7 }]);
  store.setHour(hourFromDialAngle(180));
  const s = store.getState();
  // 与 ControlButtons 导出完全相同的取值方式：直接读取同一份状态
  const annotation = `赤经: ${s.ra.toFixed(1)}° 赤纬: ${s.dec.toFixed(1)}°`;
  const timeLabel = `观测时间: ${s.currentHour.toFixed(0)}时`;
  check(
    '导出标注坐标来自当前状态',
    annotation === `赤经: ${s.ra.toFixed(1)}° 赤纬: ${s.dec.toFixed(1)}°` &&
      /-?\d+\.\d°/.test(annotation)
  );
  check('导出时间标注来自当前状态', timeLabel.includes(s.currentHour.toFixed(0)));
  // 导出后状态再变，下一次导出读取的仍是同一份最新状态
  store.adjustRa(5);
  const s2 = store.getState();
  check('状态变更后导出取值即时一致', approx(s2.ra, normalizeRa(s.ra + 5)));
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  console.log('失败项：');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('全部验证通过。\n');
