import { runSuite } from '../harness';
import { computeEclipse } from '../../src/lib/astronomy/engine';
import { GoldenCase } from '../golden-types';

const MAGNITUDE_TOL = 1e-6;
const TIME_TOL_DAYS = 1e-6;

export function goldenSuite(cases: GoldenCase[]) {
  return runSuite('golden-基准样例全链路回归', (t) => {
    t.check('基准样例已固化', cases.length > 0, `共 ${cases.length} 条`);
    for (const gc of cases) {
      t.step(`[${gc.id}] ${gc.note}`, () => {
        t.check('含期望结论(需先运行 npm run verify:update)', !!gc.expected);
        if (!gc.expected) return;
        const result = computeEclipse(gc.input);
        const exp = gc.expected;
        t.check('食类一致', result.kind === exp.kind, `${result.kind} vs ${exp.kind}`);
        t.check('食相类型一致', result.type === exp.type, `${result.type} vs ${exp.type}`);
        t.check('类型中文名一致', result.typeLabel === exp.typeLabel, result.typeLabel);
        t.approx('食分', result.magnitude, exp.magnitude, MAGNITUDE_TOL);
        t.check('可见性一致', (result.visibility?.visible ?? null) === exp.visible,
          `${result.visibility?.visible} vs ${exp.visible}`);
        t.check('可见性原因一致', (result.visibility?.reason ?? null) === exp.visibilityReason,
          result.visibility?.reason);
        for (const [key, jd] of Object.entries(exp.phases)) {
          const phase = result.phases.find((p) => p.key === key);
          t.check(`阶段 ${key} 存在`, !!phase);
          if (phase) {
            t.approx(`${phase.label} 时刻(JD-UTC)`, phase.jdUtc, jd, TIME_TOL_DAYS, 'd');
          }
        }
        const expectedPhaseKeys = new Set(Object.keys(exp.phases));
        const actualPhaseKeys = new Set(result.phases.map((p) => p.key));
        t.check(
          '阶段集合一致(无多余/缺失阶段)',
          expectedPhaseKeys.size === actualPhaseKeys.size &&
            [...expectedPhaseKeys].every((k) => actualPhaseKeys.has(k)),
        );
      });
    }
  });
}
