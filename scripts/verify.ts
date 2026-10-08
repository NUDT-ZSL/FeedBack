import * as store from '../src/store/observationStore';
import {
  hourToShichen,
  shichenToHour,
  formatTime,
  sphericalToCartesian,
  clamp,
} from '../src/utils';
import { SHICHEN_HOURS } from '../src/types';
import { CelestialBody } from '../src/types';

let passed = 0;
let failed = 0;

const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

const makeStar = (name: string, ra: number, dec: number): CelestialBody => ({
  position: sphericalToCartesian(50, ra, dec),
  color: '#ffffff',
  size: 0.05,
  name,
  latinName: `Test ${name}`,
  magnitude: 1.0,
  description: '验证用星体',
  type: 'star',
});

const scenarioNormal = () => {
  console.log('\n[场景一] 正常操作链路：时辰盘 → 浑天仪 → 点选 → 记录 → 导出');
  store.resetObservationState();

  store.setCurrentHour(14.5);
  let s = store.getState();
  check('时辰盘设定后 currentHour 归一化', s.currentHour === 14.5);
  check('时辰索引与小时换算一致', store.getShichenIndex() === hourToShichen(14.5));
  check('星空旋转角由同一时辰派生', approx(store.getSkyRotationDeg(), (14.5 / 24) * 360));
  check('时间格式化保持现状', formatTime(s.currentHour) === '14:30');

  store.adjustRa(135);
  store.adjustDec(-40);
  s = store.getState();
  check('浑天仪拖拽后赤经落库值', s.ra === 135);
  check('浑天仪拖拽后赤纬落库值', s.dec === -40);
  const annotations = store.buildChartAnnotations(new Date(2026, 9, 8));
  check(
    '星象图导出标注与浑天仪状态一致',
    annotations.coordLine === `赤经: ${s.ra.toFixed(1)}° 赤纬: ${s.dec.toFixed(1)}°`,
    annotations.coordLine
  );
  check(
    '星象图导出时间标注与当前时辰一致',
    annotations.timeLine.includes(`${s.currentHour.toFixed(0)}时`),
    annotations.timeLine
  );

  const star = makeStar('验证星甲', 123.4, 45.6);
  store.selectStar(star);
  const coords = store.getSelectedStarCoords();
  check('信息面板坐标来源于选中星体状态', coords !== null && approx(coords.ra, 123.4) && approx(coords.dec, 45.6));

  const ok = store.recordCurrentObservation();
  s = store.getState();
  const record = s.records[s.records.length - 1];
  check('记录写入成功', ok && s.records.length === 1);
  check('记录坐标与信息面板坐标一致', approx(record.ra, coords!.ra) && approx(record.dec, coords!.dec));
  check('记录时辰与当前时辰一致', record.hour === s.currentHour);
  check('记录时辰索引与面板一致', hourToShichen(record.hour) === store.getShichenIndex());
  check('记录星体名与选中星体一致', record.starName === star.name);

  const starB = makeStar('验证星乙', 260.2, -33.3);
  store.selectStar(starB);
  const coordsB = store.getSelectedStarCoords();
  store.recordCurrentObservation();
  const recordB = store.getState().records[1];
  check('切换点选后记录跟随最新选中星体', approx(recordB.ra, coordsB!.ra) && approx(recordB.dec, coordsB!.dec) && recordB.starName === starB.name);

  store.selectStar(null);
  check('未选中星体时记录被拒绝', store.recordCurrentObservation() === false);
};

const scenarioRapid = () => {
  console.log('\n[场景二] 连续快速操作：快速拖拽 + 拖动中记录 + 上限');
  store.resetObservationState();

  let expectedRa = 0;
  let expectedDec = 0;
  let recordChecks = 0;
  for (let i = 0; i < 600; i += 1) {
    store.adjustRa(1);
    expectedRa = (expectedRa + 1) % 360;
    if (i % 3 === 0) {
      const delta = i % 2 === 0 ? 7 : -5;
      store.adjustDec(delta);
      expectedDec = clamp(expectedDec + delta, -90, 90);
    }
    if (i % 25 === 0) {
      store.setCurrentHour((i * 0.5) % 24);
    }
    if (i % 50 === 0) {
      const star = makeStar(`快星${i}`, (i * 37) % 360, ((i * 13) % 120) - 60);
      store.selectStar(star);
      const before = store.getSelectedStarCoords()!;
      const ok = store.recordCurrentObservation();
      const s = store.getState();
      const record = s.records[s.records.length - 1];
      if (ok && approx(record.ra, before.ra) && approx(record.dec, before.dec) && record.hour === s.currentHour) {
        recordChecks += 1;
      }
    }
  }
  const s = store.getState();
  check('600 次快速赤经拖拽无增量丢失', s.ra === expectedRa, `期望 ${expectedRa} 实际 ${s.ra}`);
  check('快速赤纬拖拽钳制在 [-90, 90]', s.dec === expectedDec && s.dec >= -90 && s.dec <= 90);
  check('快速操作中共 12 次记录全部与当时状态一致', recordChecks === 12, `一致 ${recordChecks}/12`);
  check('快速变时后时辰索引仍由同一状态派生', store.getShichenIndex() === hourToShichen(s.currentHour));
  check('快速变时后星空旋转角仍由同一状态派生', approx(store.getSkyRotationDeg(), (s.currentHour / 24) * 360));

  store.resetObservationState();
  const fixedStar = makeStar('拖动中记录星', 77.7, 12.3);
  store.selectStar(fixedStar);
  const fixedCoords = store.getSelectedStarCoords()!;
  let dragRecordConsistent = true;
  for (let i = 0; i < 100; i += 1) {
    store.adjustRa(3);
    store.adjustDec(-2);
    if (i % 10 === 0) {
      store.recordCurrentObservation();
      const records = store.getState().records;
      const last = records[records.length - 1];
      if (!approx(last.ra, fixedCoords.ra) || !approx(last.dec, fixedCoords.dec)) {
        dragRecordConsistent = false;
      }
    }
  }
  check('浑天仪拖动过程中触发的记录与信息面板坐标一致', dragRecordConsistent);
  check('拖动后浑天仪朝向与面板读数一致', store.getState().ra === (100 * 3) % 360);

  store.resetObservationState();
  store.selectStar(makeStar('上限星', 10, 10));
  let successCount = 0;
  for (let i = 0; i < 60; i += 1) {
    if (store.recordCurrentObservation()) {
      successCount += 1;
    }
  }
  check('记录上限维持 50 条', successCount === store.MAX_RECORDS && store.getState().records.length === store.MAX_RECORDS);
  check('超出上限提示语义维持现状', store.getState().toast === store.RECORDS_FULL_MESSAGE);
  store.setToast(null);

  store.resetObservationState();
  store.setCurrentHour(25.5);
  check('时辰输入归一化到 [0, 24)', store.getState().currentHour === 1.5);
  store.adjustRa(-5);
  check('赤经负向拖拽回绕到 [0, 360)', store.getState().ra === 355);
  store.adjustDec(-200);
  check('赤纬钳制下限 -90', store.getState().dec === -90);
  store.adjustDec(400);
  check('赤纬钳制上限 90', store.getState().dec === 90);

  const conversionOk = SHICHEN_HOURS.every((h, i) => shichenToHour(i) === h);
  check('时辰→小时换算表维持现状', conversionOk);
  check('小时→时辰边界维持现状', hourToShichen(23) === 0 && hourToShichen(0) === 0 && hourToShichen(1) === 1 && hourToShichen(2) === 1);
};

scenarioNormal();
scenarioRapid();

console.log(`\n验证结果：通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
