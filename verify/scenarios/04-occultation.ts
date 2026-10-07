/**
 * 场景 4：星体互掩与遮挡临界。
 * - 近距星应在视线重合窗口内遮挡远距星，窗口外不遮挡；
 * - 重合点高度角 45°（远离地平线），遮挡与地平线判定互不干扰；
 * - 地平线下的最近星体（south_pole）不得遮挡任何人；
 * - 被遮挡星体不得计入完成度；
 * - 临界相切（角距恰等于视半径之和）不算遮挡，只标记 tangent；
 *   相切内侧必遮挡、外侧必不遮挡。
 */

import { Simulation } from '../../src/sim/engine';
import {
  OCCULTATION_CONJUNCTION_ALTITUDE,
  OCCULTATION_CONJUNCTION_TICK,
  occultationSystem,
} from '../../src/sim/fixtures/occultationSystem';
import { FixedBodyConfig, SimulationConfig } from '../../src/sim/types';
import { CheckContext } from '../harness';

export function occultationScenario(ctx: CheckContext): void {
  const sim = new Simulation(occultationSystem);

  // 重合点：远距星应被近距星遮挡，且两者都在地平线之上
  const conj = sim.snapshot(OCCULTATION_CONJUNCTION_TICK);
  ctx.approx(
    conj.bodies['far'].altitudeDeg,
    OCCULTATION_CONJUNCTION_ALTITUDE,
    1e-9,
    `tick=${OCCULTATION_CONJUNCTION_TICK} far：重合点高度角`,
  );
  ctx.ok(
    conj.bodies['far'].aboveHorizon && conj.bodies['near'].aboveHorizon,
    `tick=${OCCULTATION_CONJUNCTION_TICK}：重合时两星应在地平线之上`,
  );
  ctx.ok(
    conj.bodies['far'].occultedBy === 'near',
    `tick=${OCCULTATION_CONJUNCTION_TICK}：far 应被 near 遮挡，实际 occultedBy=${conj.bodies['far'].occultedBy}`,
  );
  ctx.ok(
    !conj.bodies['far'].visible,
    `tick=${OCCULTATION_CONJUNCTION_TICK}：far 被遮挡后不应可见`,
  );
  ctx.ok(
    conj.bodies['near'].visible,
    `tick=${OCCULTATION_CONJUNCTION_TICK}：遮挡者 near 自身应可见`,
  );

  // 全程不变量扫描
  for (let tick = 0; tick <= 360; tick += 1) {
    const snap = sim.snapshot(tick);
    const completion = sim.completion(tick);

    for (const [id, body] of Object.entries(snap.bodies)) {
      if (body.occultedBy !== null) {
        ctx.ok(
          !body.visible,
          `tick=${tick} ${id}：被 ${body.occultedBy} 遮挡却仍判定可见`,
        );
        ctx.ok(
          !completion.completedBodyIds.includes(id),
          `tick=${tick} ${id}：被遮挡却计入完成度`,
        );
        const occultor = snap.bodies[body.occultedBy];
        ctx.ok(
          occultor !== undefined && occultor.aboveHorizon,
          `tick=${tick} ${id}：遮挡者 ${body.occultedBy} 自身不在地平线之上`,
        );
      }
      if (!body.aboveHorizon) {
        ctx.ok(
          body.occultedBy === null,
          `tick=${tick} ${id}：地平线下的星体不应参与互掩判定`,
        );
      }
    }

    for (const [id, body] of Object.entries(snap.bodies)) {
      ctx.ok(
        body.occultedBy !== 'south_pole',
        `tick=${tick} ${id}：被地平线下的 south_pole 遮挡`,
      );
    }
  }

  // 遮挡窗口：重合前后 far 不可见，远离重合点 far 可见
  for (const tick of [OCCULTATION_CONJUNCTION_TICK - 2, OCCULTATION_CONJUNCTION_TICK - 1, OCCULTATION_CONJUNCTION_TICK + 1, OCCULTATION_CONJUNCTION_TICK + 2]) {
    const snap = sim.snapshot(tick);
    ctx.ok(
      snap.bodies['far'].occultedBy === 'near',
      `tick=${tick}：far 应处于遮挡窗口内`,
    );
  }
  // t=198 / t=204：far 在地平线上（h=45°）且与 near 角距 9°/12°，远离遮挡窗口
  for (const tick of [198, 204]) {
    const snap = sim.snapshot(tick);
    ctx.ok(
      snap.bodies['far'].aboveHorizon,
      `tick=${tick}：far 应在地平线之上`,
    );
    ctx.ok(
      snap.bodies['far'].visible,
      `tick=${tick}：far 远离遮挡窗口应可见`,
    );
  }

  // south_pole 在窗口内应有相当长时段位于地平线下（否则样例失去意义）
  let belowHorizonTicks = 0;
  for (let tick = 0; tick <= 360; tick += 1) {
    if (!sim.snapshot(tick).bodies['south_pole'].aboveHorizon) belowHorizonTicks += 1;
  }
  ctx.ok(
    belowHorizonTicks > 100,
    `south_pole 在窗口内地平线下时段过少（${belowHorizonTicks} tick），样例未覆盖隐星路径`,
  );

  belowHorizonOccultorCase(ctx);
  tangentCases(ctx);
}

/**
 * 构造「更近星体在地平线下、角距小于视半径之和」的临界情形：
 * 若引擎漏掉「遮挡者必须在地平线之上」的规则，远星会被误判为被遮挡。
 */
function belowHorizonOccultorCase(ctx: CheckContext): void {
  const mkBody = (
    id: string,
    physicalRadius: number,
    raDeg: number,
    distance: number,
  ): FixedBodyConfig => ({
    kind: 'fixed',
    id,
    name: id,
    physicalRadius,
    raAtEpochDeg: raDeg,
    decDeg: 0,
    raDriftDegPerTick: 0,
    epochTick: 0,
    distance,
  });

  // 赤道观测站、lst=0、赤纬 0：高度角 h = 90° - |HA|。
  // near_hidden：RA=269.5° → HA=90.5° → h=-0.5°（地平线下），视半径 asin(0.2/5)≈2.29°；
  // far_target：RA=270.5° → HA=89.5° → h=+0.5°（地平线上），视半径 asin(0.3/30)≈0.57°；
  // 角距 1° < 2.86°，若不排除地平线下遮挡者，far 会被误判遮挡。
  const config: SimulationConfig = {
    observer: {
      latitudeDeg: 0,
      lstAtEpochDeg: 0,
      lstRateDegPerTick: 15,
      epochTick: 0,
    },
    bodies: [mkBody('near_hidden', 0.2, 269.5, 5), mkBody('far_target', 0.3, 270.5, 30)],
  };
  const snap = new Simulation(config).snapshot(0);

  ctx.ok(
    !snap.bodies['near_hidden'].aboveHorizon,
    '构造用例：near_hidden 应位于地平线下',
  );
  ctx.ok(
    snap.bodies['far_target'].aboveHorizon,
    '构造用例：far_target 应位于地平线上',
  );
  ctx.ok(
    snap.bodies['far_target'].occultedBy === null,
    '地平线下的 near_hidden 不得遮挡 far_target',
  );
  ctx.ok(
    snap.bodies['far_target'].visible,
    'far_target 在地平线上且无合法遮挡者，应可见',
  );
}

/** 构造角距恰等于/略小于/略大于视半径之和的双星系统，验证临界相切规则 */
function tangentCases(ctx: CheckContext): void {
  const mkBody = (
    id: string,
    physicalRadius: number,
    raDeg: number,
    distance: number,
  ): FixedBodyConfig => ({
    kind: 'fixed',
    id,
    name: id,
    physicalRadius,
    raAtEpochDeg: raDeg,
    decDeg: 0,
    raDriftDegPerTick: 0,
    epochTick: 0,
    distance,
  });

  const build = (raFarDeg: number): Simulation => {
    const config: SimulationConfig = {
      observer: {
        latitudeDeg: 0,
        lstAtEpochDeg: 0,
        lstRateDegPerTick: 15,
        epochTick: 0,
      },
      bodies: [mkBody('near', 0.5, 0, 10), mkBody('far', 0.3, raFarDeg, 30)],
    };
    return new Simulation(config);
  };

  // 视半径之和（度）：asin(0.5/10) + asin(0.3/30)
  const sumRadiiDeg =
    (Math.asin(0.5 / 10) + Math.asin(0.3 / 30)) * (180 / Math.PI);

  const exact = build(sumRadiiDeg).snapshot(0); // t=0 时两星过中天，h≈90°
  ctx.ok(
    exact.bodies['far'].occultedBy === null,
    `临界相切（角距=${sumRadiiDeg}°=视半径之和）不应判定遮挡`,
  );
  ctx.ok(
    exact.bodies['far'].visible,
    '临界相切时远星应仍可见',
  );

  const inside = build(sumRadiiDeg * 0.999).snapshot(0);
  ctx.ok(
    inside.bodies['far'].occultedBy === 'near',
    '角距略小于视半径之和时应判定遮挡',
  );

  const outside = build(sumRadiiDeg * 1.001).snapshot(0);
  ctx.ok(
    outside.bodies['far'].occultedBy === null,
    '角距略大于视半径之和时不应判定遮挡',
  );
  ctx.ok(
    outside.bodies['far'].visible,
    '角距略大于视半径之和时远星应可见',
  );
}
