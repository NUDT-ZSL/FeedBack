import { runSuite } from '../harness';
import { solarGeometry, lunarGeometry } from '../../src/lib/astronomy/geometry';

const RS = 0.2666;
const RM = 0.249;
const SPEED = 12.19;
const T0 = 2460000;
const EPS = 1e-7;

export function boundarySuite() {
  return runSuite('boundary-食分与食相分界', (t) => {
    t.step('日全食/日环食分界: d=0 时按视半径大小定类', () => {
      const moonLarger = solarGeometry(T0, 0, RS, RM + 0.03, SPEED);
      const sunLarger = solarGeometry(T0, 0, RS, RM - 0.03, SPEED);
      t.check('月视半径>日视半径 -> total', moonLarger.type === 'total');
      t.check('日视半径>月视半径 -> annular', sunLarger.type === 'annular');
      t.approx('total 食分 = Rm/Rs', moonLarger.magnitude, (RS + RM + 0.03) / (2 * RS), 1e-12);
      t.approx('annular 食分 = Rm/Rs', sunLarger.magnitude, (RS + RM - 0.03) / (2 * RS), 1e-12);
    });

    t.step('全/环 -> 偏食分界: d 越过 |Rm-Rs| 临界', () => {
      const internal = Math.abs(RM - RS);
      const justInside = solarGeometry(T0, internal - EPS, RS, RM, SPEED);
      const justOutside = solarGeometry(T0, internal + EPS, RS, RM, SPEED);
      t.check('临界内侧为 annular', justInside.type === 'annular', justInside.type);
      t.check('临界外侧为 partial', justOutside.type === 'partial', justOutside.type);
      const magAtInternal = Math.min(RS, RM) / RS;
      t.approx('临界处食分=min(Rm,Rs)/Rs', justInside.magnitude, magAtInternal, 1e-6);
      t.approx('临界处食分=min(Rm,Rs)/Rs', justOutside.magnitude, magAtInternal, 1e-6);
    });

    t.step('偏食 -> 无食分界: d 越过 Rs+Rm, 食分降至零', () => {
      const external = RS + RM;
      const partial = solarGeometry(T0, external - EPS, RS, RM, SPEED);
      const miss = solarGeometry(T0, external + EPS, RS, RM, SPEED);
      t.check('临界内侧为 partial', partial.type === 'partial');
      t.check('临界外侧为 none', miss.type === 'none');
      t.approx('临界内侧食分趋近零', partial.magnitude, EPS / (2 * RS), 1e-9);
      t.check('临界内侧接触时刻存在', partial.contacts.first !== null && partial.contacts.fourth !== null);
      t.check('无食无接触时刻', miss.contacts.first === null && miss.contacts.fourth === null);
      t.check('无食持续时长为0', miss.durationDays === 0);
    });

    t.step('临界附近食分连续、无跳变', () => {
      const external = RS + RM;
      let prev = solarGeometry(T0, external - 0.002, RS, RM, SPEED).magnitude;
      let monotone = true;
      for (let d = external - 0.0019; d <= external + 0.002; d += 0.0001) {
        const cur = solarGeometry(T0, d, RS, RM, SPEED).magnitude;
        if (cur > prev + 1e-12) monotone = false;
        prev = cur;
      }
      t.check('食分随 d 单调递减至零', monotone);
    });

    t.step('偏食带无食既/生光, 中心食才有食既/生光', () => {
      const partial = solarGeometry(T0, (RS + RM) / 2, RS, RM, SPEED);
      const central = solarGeometry(T0, EPS, RS, RM + 0.03, SPEED);
      t.check('偏食 second/third 为 null', partial.contacts.second === null && partial.contacts.third === null);
      t.check('全食 second/third 非 null', central.contacts.second !== null && central.contacts.third !== null);
    });

    t.step('月全食/偏食/半影三层分界', () => {
      const RM_L = 0.245;
      const RU = 0.686;
      const RP = 1.22;
      const total = lunarGeometry(T0, EPS, RM_L, RU, RP, SPEED);
      const totalEdge = lunarGeometry(T0, RU - RM_L - EPS, RM_L, RU, RP, SPEED);
      const partialEdge = lunarGeometry(T0, RU - RM_L + EPS, RM_L, RU, RP, SPEED);
      const penumbral = lunarGeometry(T0, RU + RM_L + EPS, RM_L, RU, RP, SPEED);
      const miss = lunarGeometry(T0, RP + RM_L + EPS, RM_L, RU, RP, SPEED);
      t.check('d≈0 为月全食', total.type === 'total');
      t.check('本影临界内侧 total', totalEdge.type === 'total', totalEdge.type);
      t.check('本影临界外侧 partial', partialEdge.type === 'partial', partialEdge.type);
      t.check('本影外半影内 penumbral', penumbral.type === 'penumbral', penumbral.type);
      t.check('半影外 none', miss.type === 'none');
      t.approx('月全食临界本影食分=1', totalEdge.umbralMagnitude, 1, 1e-6);
    });

    t.step('接触弦长几何恒等式: 持续时长=2*sqrt((Rs+Rm)^2-d^2)/ω', () => {
      const d = 0.3;
      const g = solarGeometry(T0, d, RS, RM, SPEED);
      const expected = (2 * Math.sqrt((RS + RM) ** 2 - d * d)) / SPEED;
      t.approx('外接触持续时长', g.durationDays, expected, 1e-15);
    });

    t.step('负 d 与正 d 对称(纬度取绝对值等价)', () => {
      const a = solarGeometry(T0, 0.31, RS, RM, SPEED);
      const b = solarGeometry(T0, -0.31, RS, RM, SPEED);
      t.approx('食分相同', a.magnitude, b.magnitude, 0);
      t.check('类型相同', a.type === b.type);
    });
  });
}
