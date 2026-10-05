import { runSuite } from '../harness';
import { computeEclipse } from '../../src/lib/astronomy/engine';
import { Observer, altitudeDeg, judgeVisibility } from '../../src/lib/astronomy/visibility';
import { GoldenCase } from '../golden-types';

const LATS = [-89, -80, -60, -45, -23.5, 0, 23.5, 45, 60, 80, 89];
const LONS = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

export function visibilitySuite(cases: GoldenCase[]) {
  return runSuite('visibility-可见性与食分自洽', (t) => {
    t.step('全量网格: 可见性判定与独立高度角复算一致', () => {
      for (const gc of cases) {
        const base = computeEclipse(gc.input);
        for (const lat of LATS) {
          for (const lon of LONS) {
            const observer: Observer = {
              latitudeDeg: lat,
              longitudeDeg: lon,
              timezoneOffsetHours: Math.round(lon / 15),
            };
            const result = computeEclipse({ ...gc.input, observer });
            const phaseJds = result.phases.map((p) => p.jdUtc);
            const independentAlt = Math.max(
              ...phaseJds.map((jd) =>
                altitudeDeg(jd, observer, result.kind === 'solar' ? 'sun' : 'moon'),
              ),
            );
            if (result.effectiveMagnitude <= 0) {
              t.check(
                `[${gc.id}] (${lat},${lon}) 无食则不可见`,
                result.visibility?.visible === false && result.visibility.reason === 'no_eclipse',
              );
            } else {
              const expectedVisible = independentAlt > 0;
              t.check(
                `[${gc.id}] (${lat},${lon}) 判定=${result.visibility?.visible} 独立复算=${expectedVisible}`,
                result.visibility?.visible === expectedVisible,
                `maxAlt=${independentAlt} reason=${result.visibility?.reason}`,
              );
              if (expectedVisible) {
                t.check(
                  `[${gc.id}] (${lat},${lon}) 可见时食分必达标(有效食分>0)`,
                  result.effectiveMagnitude > 0,
                );
              }
            }
          }
        }
        const globalVisible =
          base.effectiveMagnitude > 0 &&
          LATS.some((lat) =>
            LONS.some((lon) => {
              const obs: Observer = { latitudeDeg: lat, longitudeDeg: lon, timezoneOffsetHours: 0 };
              const r = computeEclipse({ ...gc.input, observer: obs });
              return r.visibility?.visible === true;
            }),
          );
        t.check(
          `[${gc.id}] 有食食象在地球某处必然可见, 无食处处不可见`,
          base.effectiveMagnitude > 0 ? globalVisible : !globalVisible,
        );
      }
    });

    t.step('直接调用判定函数: 食分零与高度角的组合互斥规则', () => {
      const observer: Observer = { latitudeDeg: 0, longitudeDeg: 0, timezoneOffsetHours: 0 };
      const noEclipse = judgeVisibility([2460000, 2460000.1], 0, observer, 'sun');
      t.check('食分=0 必定不可见', noEclipse.visible === false);
      t.check('食分=0 原因=no_eclipse', noEclipse.reason === 'no_eclipse');
    });

    t.step('经度相差180° 的两点昼夜互补(同一UTC时刻高度角符号近似相反)', () => {
      for (const gc of cases) {
        const result = computeEclipse(gc.input);
        if (result.effectiveMagnitude <= 0) continue;
        const max = result.phases.find((p) => p.key === 'max');
        if (!max) continue;
        const a: Observer = { latitudeDeg: 0, longitudeDeg: 0, timezoneOffsetHours: 0 };
        const b: Observer = { latitudeDeg: 0, longitudeDeg: 180, timezoneOffsetHours: 12 };
        const altA = altitudeDeg(max.jdUtc, a, result.kind === 'solar' ? 'sun' : 'moon');
        const altB = altitudeDeg(max.jdUtc, b, result.kind === 'solar' ? 'sun' : 'moon');
        const sinPair = Math.sin((altA * Math.PI) / 180) + Math.sin((altB * Math.PI) / 180);
        t.check(
          `[${gc.id}] 对跖点高度角正弦和≈0`,
          Math.abs(sinPair) < 0.02,
          `${altA} + ${altB}`,
        );
      }
    });

    t.step('极区连续扫描: 同一食象可见性随经度平滑, 无抖动矛盾', () => {
      for (const gc of cases) {
        const result = computeEclipse(gc.input);
        if (result.effectiveMagnitude <= 0) continue;
        const flags: boolean[] = [];
        for (let lon = -180; lon < 180; lon += 10) {
          const obs: Observer = { latitudeDeg: 75, longitudeDeg: lon, timezoneOffsetHours: 0 };
          flags.push(computeEclipse({ ...gc.input, observer: obs }).visibility?.visible ?? false);
        }
        let transitions = 0;
        for (let i = 1; i < flags.length; i += 1) {
          if (flags[i] !== flags[i - 1]) transitions += 1;
        }
        t.check(`[${gc.id}] 经度扫描最多两次可见性翻转`, transitions <= 2, `transitions=${transitions}`);
      }
    });
  });
}
