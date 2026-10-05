/**
 * 离线推演/复核入口：不依赖真实音频与画布。
 * 运行：npm run replay
 * 通过统一批量入口 runBatchWithReport 执行一组构造好的关节角度与固定操作，
 * 断言复位结论、固定顺序判定与拒绝原因是否与预期一致，
 * 并校验局部增量重算与全量重算结果一致。
 */
import { FractureType } from '../src/types.ts';
import { TreatmentPipeline, type PipelineOperation } from '../src/engine/index.ts';

const JOINT_DEFS = [
  { id: 'upper_arm', name: '上臂（肩-肘）' },
  { id: 'forearm', name: '前臂（肘-腕）' },
  { id: 'palm', name: '手掌（腕-手）' }
];

/** 可复现的伪随机源（mulberry32） */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    failures += 1;
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

// 桡骨远端骨折目标角度：上臂 0、前臂 15、手掌 -10，允许偏差 5
const operations: PipelineOperation[] = [
  { type: 'setFracture', fractureType: FractureType.RADIAL_DISTAL },
  // 批量导入一个明显未达标的角度集（来源 import）
  { type: 'importAngles', angles: { upper_arm: 0, forearm: 100, palm: -10 } },
  // 边界：复位未达标时固定阶段不可进入
  { type: 'placeMaterial', materialId: 'cotton_pad', position: 'fracture_site' },
  // 手动逐关节调整；前臂多次调整以最后一次为准
  { type: 'adjustAngle', jointId: 'upper_arm', angle: 2, source: 'manual' },
  { type: 'adjustAngle', jointId: 'forearm', angle: 30, source: 'manual' },
  { type: 'adjustAngle', jointId: 'palm', angle: -12, source: 'manual' },
  { type: 'adjustAngle', jointId: 'forearm', angle: 22, source: 'manual' }, // 偏差 7，仍未达标
  { type: 'adjustAngle', jointId: 'forearm', angle: 19, source: 'manual' }, // 偏差 4，全部达标
  // 边界：顺序跳跃，应被拒绝并告知期望的下一步
  { type: 'placeMaterial', materialId: 'willow_splint', position: 'outer_side' },
  // 边界：顺序对但位置不对
  { type: 'placeMaterial', materialId: 'cotton_pad', position: 'elbow' },
  // 正确放置棉垫
  { type: 'placeMaterial', materialId: 'cotton_pad', position: 'fracture_site' },
  // 边界：重复放置应被拒绝且不改变已放置集合
  { type: 'placeMaterial', materialId: 'cotton_pad', position: 'fracture_site' },
  // 按既定顺序完成剩余材料
  { type: 'placeMaterial', materialId: 'willow_splint', position: 'outer_side' },
  { type: 'placeMaterial', materialId: 'bamboo_splint', position: 'inner_side' },
  { type: 'placeMaterial', materialId: 'gauze', position: 'wrap' }
];

const pipeline = new TreatmentPipeline({ joints: JOINT_DEFS });
const report = pipeline.runBatchWithReport(operations);

// ---- 复位结论与偏差 ----
const jointReport = Object.fromEntries(
  report.joints.map(j => [j.jointId, { deviation: j.deviation, ok: j.withinTolerance }])
);
check('最终各关节偏差与达标判定', jointReport, {
  upper_arm: { deviation: 2, ok: true },
  forearm: { deviation: 4, ok: true },
  palm: { deviation: -2, ok: true }
});
check('整体复位结论', report.reductionAchieved, true);
check('允许偏差由骨折协议推导', report.tolerance, 5);

// ---- 来源区分与多次调整 ----
const forearmAdjustments = report.adjustments.filter(a => a.jointId === 'forearm');
check('前臂调整记录数（含历史）', forearmAdjustments.length, 4);
check('前臂以最后一次角度为准', forearmAdjustments.at(-1)?.angle, 19);
check('调整来源被区分', new Set(report.adjustments.map(a => a.source)), new Set(['import', 'manual']));
check('调整序号严格递增', report.adjustments.map(a => a.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);

// ---- 固定顺序与拒绝原因 ----
check(
  '放置尝试接受/拒绝序列',
  report.placementAttempts.map(a => a.accepted),
  [false, false, false, true, false, true, true, true]
);
check(
  '拒绝原因序列',
  report.rejections.map(r => r.reason),
  ['REDUCTION_NOT_ACHIEVED', 'OUT_OF_ORDER', 'WRONG_POSITION', 'ALREADY_PLACED']
);
const outOfOrder = report.rejections.find(r => r.reason === 'OUT_OF_ORDER');
check('顺序跳跃时期望的下一步', outOfOrder?.expectedMaterialId, 'cotton_pad');
check('放置顺序与位置记录', report.placedMaterials, [
  { materialId: 'cotton_pad', position: 'fracture_site', sequence: 1 },
  { materialId: 'willow_splint', position: 'outer_side', sequence: 2 },
  { materialId: 'bamboo_splint', position: 'inner_side', sequence: 3 },
  { materialId: 'gauze', position: 'wrap', sequence: 4 }
]);
check('全部固定完成进入康复阶段', report.phase, 'REHABILITATION');

// ---- 批量操作记录中的阶段流转 ----
const phasesAfter = report.operations.map(op => op.phase);
check('复位未达标时阶段停留在 REDUCTION', phasesAfter[2], 'REDUCTION');
check('全部关节达标后进入 FIXATION', phasesAfter[7], 'FIXATION');
check('达标前的放置尝试也被记录为拒绝', report.operations[2].placement?.rejection?.reason, 'REDUCTION_NOT_ACHIEVED');

// ---- 增量重算 vs 全量重算一致性 ----
check('增量重算与全量重算一致', report.consistencyCheck.consistent, true);
check('一致性校验无不匹配项', report.consistencyCheck.mismatches, []);

// 再做一次“局部修正后一致性”：导入坏角度 -> 只修一个关节 -> 仍应与全量重算一致
const localPipeline = new TreatmentPipeline({ joints: JOINT_DEFS });
localPipeline.setFracture(FractureType.HUMERAL_SHAFT); // -20 / 5 / 0
localPipeline.importAngles({ upper_arm: -20, forearm: 60, palm: 0 });
check('局部修正前未达标', localPipeline.reductionAchieved, false);
localPipeline.adjustAngle('forearm', 8, 'manual'); // 偏差 3
const localReport = localPipeline.exportReport();
check('局部修正后整体达标', localReport.reductionAchieved, true);
check('局部修正后增量/全量一致', localReport.consistencyCheck.consistent, true);
check('仅受影响关节的偏差重算', localReport.joints.find(j => j.jointId === 'forearm')?.deviation, 3);

// ---- 随机来源与可复现性 ----
const seedA = new TreatmentPipeline({ joints: JOINT_DEFS, rng: seededRng(42) });
seedA.setFracture(FractureType.OLECRANON, true);
const seedB = new TreatmentPipeline({ joints: JOINT_DEFS, rng: seededRng(42) });
seedB.setFracture(FractureType.OLECRANON, true);
check('同一随机种子下初始角度可复现', seedA.exportReport().joints, seedB.exportReport().joints);
check('随机初始化的来源被标记为 random', [
  ...new Set(seedA.exportReport().adjustments.map(a => a.source))
], ['random']);

console.log('');
console.log('===== 离线核对报告（摘要 JSON）=====');
console.log(JSON.stringify({
  fractureType: report.fractureType,
  reductionAchieved: report.reductionAchieved,
  joints: report.joints,
  placedMaterials: report.placedMaterials,
  rejections: report.rejections,
  consistencyCheck: report.consistencyCheck
}, null, 2));

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log('\n全部断言通过');
