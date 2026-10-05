import { FractureType } from '../src/types';
import {
  TreatmentSession,
  runBatchScenario,
  FixationRejection,
  getFractureTargetAngles,
  type BatchScenario,
  type FixationMaterialSpec,
  type ReductionReport
} from '../src/pipeline';

const JOINT_IDS = ['upper_arm', 'forearm', 'palm'];

const MATERIALS: FixationMaterialSpec[] = [
  { id: 'cotton_pad', name: '棉垫', type: 'cotton_pad', order: 1, correctPosition: 'fracture_site' },
  { id: 'willow_splint', name: '柳木夹板', type: 'willow_splint', order: 2, correctPosition: 'outer_side' },
  { id: 'bamboo_splint', name: '竹制夹板', type: 'bamboo_splint', order: 3, correctPosition: 'inner_side' },
  { id: 'gauze', name: '纱布绷带', type: 'gauze', order: 4, correctPosition: 'wrap' }
];

let failures = 0;

const check = (label: string, condition: boolean, detail = '') => {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ''}`);
};

const showReduction = (report: ReductionReport | null) => {
  if (!report) {
    console.log('    复位报告: <无>');
    return;
  }
  const parts = report.joints
    .map(j => `${j.jointId}: 当前${j.currentAngle.toFixed(1)}° 目标${j.targetAngle}° 偏差${j.deviation.toFixed(1)}° ${j.withinTolerance ? '✓' : '✗'}`)
    .join(' | ');
  console.log(`    复位结论: ${report.allWithinTolerance ? '达标' : '未达标'} (最大偏差 ${report.maxAbsDeviation.toFixed(1)}°)`);
  console.log(`    ${parts}`);
};

// ---------------------------------------------------------------------------
console.log('\n=== 场景 1: 复位未达标时固定被拒绝，达标后按顺序放置 ===');
{
  const target = getFractureTargetAngles(FractureType.RADIAL_DISTAL);
  const misaligned = Object.fromEntries(
    Object.entries(target).map(([id, angle]) => [id, angle + 12])
  );

  const scenario: BatchScenario = {
    name: 'reduction-gate-and-fixation-order',
    jointIds: JOINT_IDS,
    materials: MATERIALS,
    operations: [
      { type: 'set_fracture', fractureType: FractureType.RADIAL_DISTAL, initialAngles: misaligned },
      { type: 'place_material', materialId: 'cotton_pad', position: 'fracture_site' },
      { type: 'adjust_angle', jointId: 'upper_arm', angle: target.upper_arm, source: 'manual' },
      { type: 'adjust_angle', jointId: 'forearm', angle: target.forearm, source: 'manual' },
      { type: 'adjust_angle', jointId: 'palm', angle: target.palm, source: 'manual' },
      { type: 'place_material', materialId: 'gauze', position: 'wrap' },
      { type: 'place_material', materialId: 'cotton_pad', position: 'outer_side' },
      { type: 'place_material', materialId: 'cotton_pad', position: 'fracture_site' },
      { type: 'place_material', materialId: 'cotton_pad', position: 'fracture_site' },
      { type: 'place_material', materialId: 'willow_splint', position: 'outer_side' },
      { type: 'place_material', materialId: 'bamboo_splint', position: 'inner_side' },
      { type: 'place_material', materialId: 'gauze', position: 'wrap' }
    ]
  };

  const result = runBatchScenario(scenario);
  const { steps, finalReport } = result;

  console.log(`  步骤追踪（共 ${steps.length} 步）:`);
  for (const step of steps) {
    const op = step.operation;
    if (op.type === 'place_material' && step.fixationAttempt) {
      const a = step.fixationAttempt;
      console.log(`    #${step.index} 放置 ${op.materialId}@${op.position} -> ${a.accepted ? '接受' : `拒绝[${a.rejection}]`} ${a.reason}`);
    } else if (op.type === 'adjust_angle') {
      console.log(`    #${step.index} 调整 ${op.jointId} -> ${op.angle}° (来源: ${op.source ?? 'batch'})`);
    } else if (op.type === 'set_fracture') {
      console.log(`    #${step.index} 设定骨折类型 ${op.fractureType}`);
    }
  }
  showReduction(finalReport.reduction);

  check('复位未达标时固定被拒绝', steps[1].fixationAttempt?.rejection === FixationRejection.REDUCTION_NOT_PASSED);
  check('全部关节修正后复位达标', finalReport.reduction?.allWithinTolerance === true);
  check('顺序跳跃被拒绝并指定期望材料',
    steps[5].fixationAttempt?.rejection === FixationRejection.ORDER_VIOLATION &&
    steps[5].fixationAttempt?.expectedNextMaterialId === 'cotton_pad');
  check('位置错误被拒绝', steps[6].fixationAttempt?.rejection === FixationRejection.WRONG_POSITION);
  check('正确顺序+位置被接受', steps[7].fixationAttempt?.accepted === true);
  check('重复放置被拒绝', steps[8].fixationAttempt?.rejection === FixationRejection.ALREADY_PLACED);
  check('重复放置后已放置集合不变',
    finalReport.fixation.placedOrder.filter(id => id === 'cotton_pad').length === 1);
  check('最终放置顺序为 1-4',
    JSON.stringify(finalReport.fixation.placedOrder) ===
    JSON.stringify(['cotton_pad', 'willow_splint', 'bamboo_splint', 'gauze']));
  check('固定流程完成', finalReport.fixation.complete === true);
  check('增量重算与全量重算一致', result.consistency.incrementalMatchesFull);
  check('有效角度与调整日志一致', result.consistency.effectiveAnglesMatchLog);
}

// ---------------------------------------------------------------------------
console.log('\n=== 场景 2: 同一关节多次调整以最后一次为准，调整记录全部保留 ===');
{
  const target = getFractureTargetAngles(FractureType.HUMERAL_SHAFT);
  const scenario: BatchScenario = {
    name: 'last-adjustment-wins',
    jointIds: JOINT_IDS,
    materials: MATERIALS,
    operations: [
      {
        type: 'set_fracture',
        fractureType: FractureType.HUMERAL_SHAFT,
        initialAngles: { upper_arm: -35, forearm: 20, palm: -15 },
        initialAngleSource: 'random'
      },
      { type: 'adjust_angle', jointId: 'forearm', angle: 30, source: 'manual' },
      { type: 'adjust_angle', jointId: 'forearm', angle: -8, source: 'manual' },
      { type: 'adjust_angle', jointId: 'forearm', angle: target.forearm, source: 'batch' },
      { type: 'adjust_angle', jointId: 'upper_arm', angle: target.upper_arm, source: 'manual' },
      { type: 'adjust_angle', jointId: 'palm', angle: target.palm, source: 'manual' }
    ]
  };

  const result = runBatchScenario(scenario);
  const { finalReport } = result;
  const forearmRecords = finalReport.adjustments.filter(a => a.jointId === 'forearm');

  console.log(`  forearm 调整记录: ${forearmRecords.map(a => `#${a.sequence}=${a.angle}°(${a.source})`).join(', ')}`);
  showReduction(finalReport.reduction);

  check('forearm 保留全部 4 条调整记录（含初始随机）', forearmRecords.length === 4);
  check('forearm 生效角度为最后一次调整值', finalReport.effectiveAngles.forearm === target.forearm);
  check('调整来源可区分（random/manual/batch）',
    finalReport.adjustments.some(a => a.source === 'random') &&
    finalReport.adjustments.some(a => a.source === 'manual') &&
    finalReport.adjustments.some(a => a.source === 'batch'));
  check('复位最终达标', finalReport.reduction?.allWithinTolerance === true);
  check('增量重算与全量重算一致', result.consistency.incrementalMatchesFull);
  check('有效角度与调整日志一致', result.consistency.effectiveAnglesMatchLog);
}

// ---------------------------------------------------------------------------
console.log('\n=== 场景 3: 逐步局部修正，每一步增量重算都与全量重算一致 ===');
{
  const target = getFractureTargetAngles(FractureType.OLECRANON);
  const session = new TreatmentSession(JOINT_IDS, MATERIALS);
  session.setFracture(FractureType.OLECRANON, {
    initialAngles: { upper_arm: 30, forearm: -40, palm: 25 },
    initialAngleSource: 'batch'
  });

  let allStepsConsistent = true;
  const corrections: Array<[string, number]> = [
    ['upper_arm', target.upper_arm + 3],
    ['forearm', target.forearm - 4],
    ['palm', target.palm],
    ['upper_arm', target.upper_arm],
    ['forearm', target.forearm]
  ];
  corrections.forEach(([jointId, angle], i) => {
    session.adjustAngle(jointId, angle, 'manual');
    const incremental = session.getReductionReport();
    const full = session.fullRecompute();
    const same = JSON.stringify(incremental) === JSON.stringify(full);
    if (!same) allStepsConsistent = false;
    console.log(`    步骤${i + 1}: 修正 ${jointId} -> ${angle}°, 达标=${incremental?.allWithinTolerance}, 增量=全量: ${same}`);
  });

  check('每一步局部修正后增量重算与全量重算一致', allStepsConsistent);
  check('修正完成后复位达标', session.reductionPassed());

  const exported = session.exportReport();
  console.log(`  导出报告: 调整记录 ${exported.adjustments.length} 条, 固定尝试 ${exported.fixation.attempts.length} 条`);
  check('导出报告包含完整调整记录', exported.adjustments.length === 3 + corrections.length);
}

// ---------------------------------------------------------------------------
console.log('\n=== 场景 4: 复位达标前所有固定尝试均被拒绝，已放置集合保持为空 ===');
{
  const session = new TreatmentSession(JOINT_IDS, MATERIALS);
  session.setFracture(FractureType.RADIAL_DISTAL, {
    initialAngles: { upper_arm: 20, forearm: 30, palm: -25 },
    initialAngleSource: 'batch'
  });

  const attempts = [
    session.attemptFixation('cotton_pad', 'fracture_site'),
    session.attemptFixation('gauze', 'wrap')
  ];
  const exported = session.exportReport();

  check('复位未达标时所有固定尝试被拒绝',
    attempts.every(a => !a.accepted && a.rejection === FixationRejection.REDUCTION_NOT_PASSED));
  check('已放置集合保持为空', exported.fixation.placedOrder.length === 0);
  check('拒绝原因已记录可追溯', exported.fixation.attempts.length === 2 &&
    exported.fixation.attempts.every(a => a.reason.length > 0));
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\n全部场景通过 ✔' : `\n${failures} 项断言失败 �’`);
process.exit(failures === 0 ? 0 : 1);
