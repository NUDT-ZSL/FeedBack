import { runSuite } from '../harness';
import { computeEclipse, EclipseResult } from '../../src/lib/astronomy/engine';
import { Observer, altitudeDeg } from '../../src/lib/astronomy/visibility';
import { jdToCivil } from '../../src/lib/astronomy/time';
import { GoldenCase } from '../golden-types';

const TIMEZONES = [-12, -9.5, -5, 0, 3, 5.75, 8, 9.5, 12, 14];

function phaseByKey(result: EclipseResult, key: string) {
  return result.phases.find((p) => p.key === key);
}

function validCivil(hour: number, month: number, day: number): boolean {
  return (
    Number.isFinite(hour) &&
    hour >= 0 &&
    hour < 24 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31
  );
}

export function phasesSuite(cases: GoldenCase[]) {
  return runSuite('phases-时刻先后与单调性', (t) => {
    for (const gc of cases) {
      t.step(`[${gc.id}] ${gc.note}`, () => {
        const observer: Observer = gc.input.observer;
        const result = computeEclipse({ ...gc.input, observer });

        const first = phaseByKey(
          result,
          result.kind === 'solar'
            ? 'first'
            : (phaseByKey(result, 'umbralFirst') ? 'umbralFirst' : 'penumbralFirst'),
        );
        const max = phaseByKey(result, 'max');
        const last = phaseByKey(
          result,
          result.kind === 'solar'
            ? 'fourth'
            : (phaseByKey(result, 'umbralFourth') ? 'umbralFourth' : 'penumbralFourth'),
        );

        if (result.effectiveMagnitude > 0) {
          t.check('初亏/食甚/复圆均存在', !!first && !!max && !!last);
          if (first && max && last) {
            t.check(
              'UTC 时刻单调: 初亏 <= 食甚 <= 复圆',
              first.jdUtc <= max.jdUtc && max.jdUtc <= last.jdUtc,
              `${first.jdUtc} ${max.jdUtc} ${last.jdUtc}`,
            );
            t.check('持续时长为正', last.jdUtc > first.jdUtc);
          }
        }

        for (const tz of TIMEZONES) {
          const shifted = computeEclipse({
            ...gc.input,
            observer: { ...observer, timezoneOffsetHours: tz },
          });
          const keys = shifted.phases.map((p) => p.key);
          const baseJds = result.phases.map((p) => p.jdUtc);
          const shiftedJds = shifted.phases.map((p) => p.jdUtc);
          t.check(
            `tz=${tz} 时刻不随时区漂移`,
            JSON.stringify(baseJds) === JSON.stringify(shiftedJds),
          );
          const ordered = shiftedJds.every((v, i) => i === 0 || shiftedJds[i - 1] <= v);
          t.check(`tz=${tz} 各阶段本地时刻保持先后次序`, ordered);
          for (const p of shifted.phases) {
            if (p.local) {
              const ok = validCivil(p.local.hour, p.local.month, p.local.day);
              t.check(`tz=${tz} ${p.label} 本地时间字段合法(可跨日)`, ok,
                `${p.local.year}-${p.local.month}-${p.local.day} ${p.local.hour}`);
              const expectedLocal = jdToCivil(p.jdUtc + tz / 24);
              t.check(
                `tz=${tz} ${p.label} 本地时刻=UTC+偏移`,
                Math.abs(expectedLocal.hour - p.local.hour) < 1e-9 &&
                  expectedLocal.day === p.local.day &&
                  expectedLocal.month === p.local.month,
              );
            }
          }
          void keys;
        }
      });
    }

    t.step('极区观测(±89.5°)不产生非法值且高度角有界', () => {
      for (const gc of cases) {
        for (const lat of [-89.5, 89.5]) {
          const observer: Observer = { ...gc.input.observer, latitudeDeg: lat };
          const result = computeEclipse({ ...gc.input, observer });
          for (const p of result.phases) {
            const alt = altitudeDeg(p.jdUtc, observer, result.kind === 'solar' ? 'sun' : 'moon');
            t.check(
              `[${gc.id}] lat=${lat} ${p.label} 高度角在 [-90,90]`,
              Number.isFinite(alt) && alt >= -90 && alt <= 90,
              `alt=${alt}`,
            );
          }
          if (result.visibility) {
            t.check(
              `[${gc.id}] lat=${lat} 可见性结论为布尔`,
              typeof result.visibility.visible === 'boolean',
            );
          }
        }
      }
    });

    t.step('极区食甚前后高度角变化缓慢(极昼/极夜场景稳定)', () => {
      for (const gc of cases.filter((c) => c.input.kind !== 'lunar')) {
        const observer: Observer = { ...gc.input.observer, latitudeDeg: 89.5 };
        const result = computeEclipse({ ...gc.input, observer });
        if (result.magnitude <= 0) continue;
        const first = phaseByKey(result, 'first');
        const last = phaseByKey(result, 'fourth');
        if (!first || !last) continue;
        const altA = altitudeDeg(first.jdUtc, observer, 'sun');
        const altB = altitudeDeg(last.jdUtc, observer, 'sun');
        t.check(
          `[${gc.id}] 极区初亏/复圆高度角差 < 0.5°`,
          Math.abs(altA - altB) < 0.5,
          `${altA} vs ${altB}`,
        );
      }
    });
  });
}
