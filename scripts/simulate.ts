/**
 * 离线全链路演示：环境压力驱动的性状漂移 → 繁育继承 → 谱系回溯。
 * 运行：npm run simulate
 * 不依赖任何外部服务，纯 Node + 本地 TypeScript 编译产物。
 */
import {
  Plant,
  OptimalEnvironment,
  PlantTraits,
  createBasePlant,
  traceAncestry,
  EnvOrigin,
} from '../src/plants';
import { DriftSystem } from '../src/drift';
import { EnvironmentSystem } from '../src/environment';

let failures = 0;
function check(condition: boolean, message: string): void {
  const tag = condition ? '  [通过] ' : '  [失败] ';
  console.log(tag + message);
  if (!condition) {
    failures += 1;
  }
}
function approx(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function fmtTraits(t: PlantTraits): string {
  return `颜色=${t.color.toFixed(1)} 形态=${t.shape.toFixed(1)} 高度=${t.height.toFixed(1)} 耐旱=${t.droughtResistance.toFixed(1)}`;
}
function fmtEnv(e: OptimalEnvironment): string {
  return `温度[${e.tempMin.toFixed(1)},${e.tempMax.toFixed(1)}] 湿度[${e.humidityMin.toFixed(1)},${e.humidityMax.toFixed(1)}] 光照[${e.lightMin.toFixed(1)},${e.lightMax.toFixed(1)}]`;
}
function fmtOrigin(o: EnvOrigin): void {
  for (const dim of ['temperature', 'humidity', 'light'] as const) {
    const entry = o[dim];
    const sources = entry.sources
      .map(s => `${s.plantName}(${s.range.map(v => v.toFixed(1)).join(',')})`)
      .join(' / ');
    console.log(`      ${dim}: ${entry.resolution} <= 来源: ${sources || '基础植物'}`);
    if (entry.rule) {
      console.log(`        依据: ${entry.rule}`);
    }
  }
}

const registry = new Map<string, Plant>();
function register(plant: Plant): Plant {
  registry.set(plant.id, plant);
  return plant;
}

const driftSystem = new DriftSystem();
const envSystem = new EnvironmentSystem();
// 演示中手动控制环境，关闭系统的自动随机目标切换
envSystem.changeInterval = Number.MAX_SAFE_INTEGER;
let clock = 0;
function forceEnv(temp: number, humidity: number, light: number): void {
  envSystem.state.temperature = temp;
  envSystem.state.targetTemperature = temp;
  envSystem.state.humidity = humidity;
  envSystem.state.targetHumidity = humidity;
  envSystem.state.light = light;
  envSystem.state.targetLight = light;
}
/** 持续生长 ticks 个 1 秒 */
function grow(plant: Plant, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    clock += 1000;
    envSystem.update(1000, clock);
    driftSystem.update(plant, envSystem.state, 1000);
  }
}

console.log('==== 1. 初始基础植物（蕨类）====');
const fern = register(createBasePlant('fern'));
const cactus = register(createBasePlant('cactus'));
const mushroom = register(createBasePlant('mushroom'));
console.log(`蕨类 ${fern.name}  世代=${fern.generation}`);
console.log('  性状: ' + fmtTraits(fern.traits));
console.log('  最适: ' + fmtEnv(fern.optimalEnv));
const initialTraits = { ...fern.traits };
const initialEnv = { ...fern.optimalEnv };

console.log('\n==== 2. 长期处于偏离环境（38°C / 10%湿度 / 95光照，持续120秒）====');
forceEnv(38, 10, 95);
grow(fern, 120);
driftSystem.flushAll(fern);
console.log('  性状: ' + fmtTraits(fern.traits));
console.log('  最适: ' + fmtEnv(fern.optimalEnv));
console.log(`  累计暴露(ms): 温度=${fern.stressExposure.temperature} 湿度=${fern.stressExposure.humidity} 光照=${fern.stressExposure.light}`);
console.log(`  累计漂移幅度: ${fern.cumulativeDrift.toFixed(2)}`);
console.log('  漂移片段:');
for (const ev of fern.driftEvents) {
  console.log(`    - ${ev.dimension}: 暴露${ev.exposureMs}ms 平均环境=${ev.avgEnvValue} 区间[${ev.rangeBefore.map(v => v.toFixed(1)).join(',')}] -> [${ev.rangeAfter.map(v => v.toFixed(1)).join(',')}] 性状=${JSON.stringify(ev.traitDeltas)}`);
}
check(fern.optimalEnv.tempMin > initialEnv.tempMin, '高温胁迫使温度最适区间整体上移（向环境靠拢）');
check(fern.optimalEnv.humidityMax < initialEnv.humidityMax, '干旱胁迫使湿度最适区间整体下移（向环境靠拢）');
check(fern.optimalEnv.lightMin > initialEnv.lightMin, '强光照使光照最适区间整体上移');
check(fern.traits.droughtResistance < initialTraits.droughtResistance - 5, '干旱方向之外的性状联动：湿度区间下移时耐旱性被定向改写');
check(fern.traits.height > initialTraits.height, '高温方向使高度性状增大');
check(fern.cumulativeDrift > 0, '产生了可量化的累计漂移');

const driftAfterPhase1 = fern.cumulativeDrift;
const exposurePhase1 = { ...fern.stressExposure };
const eventsAfterPhase1 = fern.driftEvents.length;

console.log('\n==== 3. 回到最适区间内生长（30秒，应零漂移）====');
forceEnv(30, 50, 50);
grow(fern, 30);
check(fern.cumulativeDrift === driftAfterPhase1, '区间内生长不产生新漂移，累计幅度保持不变');
check(
  fern.stressExposure.temperature === exposurePhase1.temperature &&
  fern.stressExposure.humidity === exposurePhase1.humidity &&
  fern.stressExposure.light === exposurePhase1.light,
  '回到区间内不清零历史暴露时长'
);
check(fern.driftEvents.length === eventsAfterPhase1, '区间内不新增漂移片段');

console.log('\n==== 4. 边界值包含测试（环境恰好等于区间端点）====');
const envAtMin = fern.cumulativeDrift;
forceEnv(fern.optimalEnv.tempMin, fern.optimalEnv.humidityMin, fern.optimalEnv.lightMin);
grow(fern, 10);
check(fern.cumulativeDrift === envAtMin, '环境恰好落在各区间下界时不漂移（边界包含）');
forceEnv(fern.optimalEnv.tempMax, fern.optimalEnv.humidityMax, fern.optimalEnv.lightMax);
grow(fern, 10);
check(fern.cumulativeDrift === envAtMin, '环境恰好落在各区间上界时不漂移（边界包含）');

console.log('\n==== 5. 再次进入同样的偏离环境（60秒，按实际时长继续累积）====');
forceEnv(38, 10, 95);
grow(fern, 60);
driftSystem.flushAll(fern);
const newEvents = fern.driftEvents.slice(eventsAfterPhase1);
check(
  fern.stressExposure.temperature === 180000 &&
  fern.stressExposure.humidity === 180000 &&
  fern.stressExposure.light === 180000,
  '暴露时长按实际 120+60 秒累计，离开再回来不清零'
);
check(newEvents.length === 3 && newEvents.every(e => e.exposureMs === 60000), '第二次胁迫独立结算为新片段，每个片段恰好 60 秒（不翻倍、不重复）');
check(fern.cumulativeDrift > driftAfterPhase1, '第二次暴露产生新的渐进偏移（不是从零重来，也没有翻倍）');
for (const first of fern.driftEvents.slice(0, 3)) {
  const second = newEvents.find(e => e.dimension === first.dimension)!;
  check(second.magnitude < first.magnitude, `${first.dimension} 维度二次漂移幅度小于首次（区间已部分适应该方向）`);
}

console.log('\n==== 6. 漂移后的植株繁育后代（偏移必须被继承）====');
console.log('--- 6a. 自交 ---');
const selfChild = register(Plant.selfCross(fern));
console.log('  子代最适: ' + fmtEnv(selfChild.optimalEnv));
check(
  JSON.stringify({ ...selfChild.optimalEnv }) === JSON.stringify({ ...fern.optimalEnv }),
  '自交子代完整继承被环境改写后的最适区间'
);
check(selfChild.optimalEnv.tempMin === fern.optimalEnv.tempMin, '自交子代温度区间未退回原始基础植物取值');
check(selfChild.envOrigin.humidity.resolution === 'inherited', '自交子代区间来源标记为继承亲本');

console.log('--- 6b. 杂交（漂移蕨类 × 基础仙人掌：湿度区间互相矛盾）---');
const hybrid = register(Plant.hybridize(fern, cactus));
console.log('  蕨类湿度区间: [' + fern.optimalEnv.humidityMin.toFixed(1) + ',' + fern.optimalEnv.humidityMax.toFixed(1) + ']');
console.log('  仙人掌湿度区间: [' + cactus.optimalEnv.humidityMin + ',' + cactus.optimalEnv.humidityMax + ']');
console.log('  子代最适: ' + fmtEnv(hybrid.optimalEnv));
console.log('  区间来源与裁决:');
fmtOrigin(hybrid.envOrigin);
check(hybrid.envOrigin.humidity.resolution === 'adjudicated', '矛盾的湿度区间被标记为冲突裁决，而非静默平均');
check(hybrid.envOrigin.humidity.sources.length === 2, '冲突时双亲双方的原始区间都被保留');
check(
  approx(hybrid.optimalEnv.humidityMin, (fern.optimalEnv.humidityMin + cactus.optimalEnv.humidityMin) / 2, 1),
  '裁决生效值仍可按双亲计算（依据完整可追溯）'
);
check(
  approx(hybrid.optimalEnv.tempMin, (fern.optimalEnv.tempMin + cactus.optimalEnv.tempMin) / 2, 1),
  '杂交子代温度区间取自漂移后的蕨类当前值，而非初始值'
);
check(
  hybrid.traits.color === fern.traits.color || hybrid.traits.color === cactus.traits.color ||
    Math.abs(hybrid.traits.color - (fern.traits.color + cactus.traits.color) / 2) <= 21,
  '子代性状从双亲（含漂移性状）继承或融合'
);

console.log('--- 6c. 回交（杂交子代回交漂移蕨类，共享祖先不重复）---');
const backcrossed = register(Plant.backcross(hybrid, fern));
console.log('  回交子代最适: ' + fmtEnv(backcrossed.optimalEnv));
check(
  approx(backcrossed.optimalEnv.tempMin, hybrid.optimalEnv.tempMin * 0.4 + fern.optimalEnv.tempMin * 0.6, 1),
  '回交子代按 40/60 权重继承双方当前（已漂移）区间'
);

console.log('--- 6d. 回交矛盾区间（漂移蕨类 × 基础仙人掌直接回交：偏湿 vs 偏干）---');
const bcConflict = register(Plant.backcross(fern, cactus));
console.log('  区间来源与裁决:');
fmtOrigin(bcConflict.envOrigin);
check(bcConflict.envOrigin.humidity.resolution === 'adjudicated', '回交矛盾湿度区间走裁决流程');
check(bcConflict.envOrigin.humidity.rule!.includes('60'), '裁决规则注明了 40/60 偏向递归亲本的依据');

console.log('\n==== 7. 谱系回溯（回交子代 → 基础植物，标出漂移世代）====');
const report = traceAncestry(backcrossed, registry);
console.log('  世代链（去重后按世代排序）:');
const seenIds = new Set<string>();
for (const node of report.nodes) {
  const tag = node.isBase ? '基础植物' : '子代';
  const drift = node.driftMagnitude > 0 ? `  <<漂移 累计=${node.driftMagnitude.toFixed(2)} (${node.driftEvents.length}个片段)` : '';
  console.log(`    世代${node.plant.generation} ${tag} ${node.plant.name} (${node.plant.id})${drift}`);
  seenIds.add(node.plant.id);
}
console.log(`  链上累计漂移幅度: ${report.totalDrift.toFixed(2)}`);
check(seenIds.size === report.nodes.length, '共享祖先只计入一次，无重复计入（回交中的蕨类同时是亲本与祖辈）');
const allIds = new Set(report.nodes.map(n => n.plant.id));
for (const node of report.nodes.filter(n => !n.isBase)) {
  for (const pid of node.plant.parentIds) {
    check(allIds.has(pid), `植株 ${node.plant.name} 的亲本 ${pid} 在谱系中可找到（无断链）`);
  }
}
const baseNodes = report.nodes.filter(n => n.isBase);
check(baseNodes.some(n => n.plant.id === fern.id), '回溯可达最初的基础植物（蕨类）');
check(baseNodes.some(n => n.plant.id === cactus.id), '回溯可达最初的基础植物（仙人掌）');
const driftGens = report.driftGenerations.map(n => n.plant.name).join(', ');
console.log('  发生漂移的世代: ' + driftGens);
check(report.driftGenerations.length === 1 && report.driftGenerations[0].plant.id === fern.id, '准确标出漂移发生在蕨类这一代（子代只继承，不重复计算漂移）');
check(approx(report.totalDrift, fern.cumulativeDrift, 0.001), '整条谱系的累计漂移幅度等于漂移世代的累计值');

console.log('\n==== 8. 导出/导入保持漂移证据（JSON 往返）====');
const json = JSON.parse(JSON.stringify(fern.toJSON()));
const restored = Plant.fromJSON(json);
check(restored.cumulativeDrift === fern.cumulativeDrift, '导入后累计漂移幅度保持');
check(restored.stressExposure.temperature === fern.stressExposure.temperature, '导入后累计暴露时长保持');
check(restored.driftEvents.length === fern.driftEvents.length, '导入后漂移片段记录保持');
check(restored.envOrigin.humidity.resolution === fern.envOrigin.humidity.resolution, '导入后区间来源依据保持');

console.log('\n========================================');
if (failures === 0) {
  console.log('全部检查通过 ✅ 漂移链路离线运行正常');
} else {
  console.log(`有 ${failures} 项检查失败 ❌`);
  throw new Error(`simulation checks failed: ${failures}`);
}
