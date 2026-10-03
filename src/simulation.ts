import { Plant, createBasePlant, OptimalEnvironment } from './plants.js';
import { EnvironmentSystem } from './environment.js';
import { EnvironmentalDriftSystem } from './drift.js';
import { LineageBook } from './lineage.js';

let failures = 0;

function check(name: string, condition: boolean, detail: string = ''): void {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) {
    failures++;
  }
  console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`);
}

function fmtEnv(env: OptimalEnvironment): string {
  return `温度[${env.tempMin},${env.tempMax}] 湿度[${env.humidityMin},${env.humidityMax}] 光照[${env.lightMin},${env.lightMax}]`;
}

function runEnv(drift: EnvironmentalDriftSystem, plant: Plant, env: { temperature: number; humidity: number; light: number }, seconds: number, startTime: number): number {
  let t = startTime;
  for (let i = 0; i < seconds; i++) {
    t += 1;
    drift.update(plant, env, 1, t);
  }
  return t;
}

const drift = new EnvironmentalDriftSystem();
const book = new LineageBook();

console.log('=== 1. 长期偏离环境 → 性状与最适区间渐进漂移 ===');
const sun = createBasePlant('sunflower');
book.register(sun);
const initialTraits = { ...sun.traits };
const initialEnv = { ...sun.optimalEnv };
console.log(`  初始性状: ${JSON.stringify(initialTraits)}`);
console.log(`  初始区间: ${fmtEnv(initialEnv)}`);

const hotDry = { temperature: 40, humidity: 10, light: 80 };
const optimal = { temperature: 25, humidity: 50, light: 80 };

let clock = runEnv(drift, sun, hotDry, 300, 0);
drift.finalize(sun, clock);
const driftAfterPhaseA = sun.getCumulativeDrift();
console.log(`  热干环境 300s 后: 性状=${JSON.stringify(sun.traits)}`);
console.log(`  区间: ${fmtEnv(sun.optimalEnv)}`);
check('耐旱性上升(干胁迫)', sun.traits.droughtResistance > initialTraits.droughtResistance,
  `${initialTraits.droughtResistance} → ${sun.traits.droughtResistance}`);
check('颜色偏移(热胁迫)', sun.traits.color > initialTraits.color,
  `${initialTraits.color} → ${sun.traits.color}`);
check('湿度区间下限下移(适应干燥)', sun.optimalEnv.humidityMin < initialEnv.humidityMin,
  `${initialEnv.humidityMin} → ${sun.optimalEnv.humidityMin}`);
check('温度区间上移(适应炎热)', sun.optimalEnv.tempMin > initialEnv.tempMin,
  `${initialEnv.tempMin} → ${sun.optimalEnv.tempMin}`);
check('光照未越界则无光照漂移', sun.optimalEnv.lightMin === initialEnv.lightMin && sun.optimalEnv.lightMax === initialEnv.lightMax);

console.log('=== 2. 反复进出环境区间 → 按实际暴露累积, 不清零不翻倍 ===');
const stressAfterA = sun.totalStressTime;
clock = runEnv(drift, sun, optimal, 100, clock);
check('回到适宜区间不产生漂移', sun.totalStressTime === stressAfterA && sun.driftHistory.length === 1,
  `受压时长=${sun.totalStressTime}s, 漂移段落=${sun.driftHistory.length}`);
const traitsAfterRest = { ...sun.traits };
clock = runEnv(drift, sun, hotDry, 200, clock);
drift.finalize(sun, clock);
check('受压时长精确累积 300+200=500', sun.totalStressTime === 500, `实际=${sun.totalStressTime}`);
check('再次进入胁迫继续漂移而非清零', sun.traits.droughtResistance > traitsAfterRest.droughtResistance,
  `${traitsAfterRest.droughtResistance} → ${sun.traits.droughtResistance}`);
check('离开期间性状保持(未回退)', traitsAfterRest.droughtResistance === Math.round(driftAfterPhaseA.traits.droughtResistance + initialTraits.droughtResistance));
check('漂移记录为两个独立段落', sun.driftHistory.length === 2,
  `段落时长: ${sun.driftHistory.map(e => e.duration).join('s, ')}s`);

console.log('=== 3. 边界值按包含处理 → 恰好落在区间边界不漂移 ===');
const edge = createBasePlant('sunflower');
book.register(edge);
let edgeClock = runEnv(drift, edge, { temperature: 20, humidity: 70, light: 60 }, 100, 0);
edgeClock = runEnv(drift, edge, { temperature: 35, humidity: 30, light: 100 }, 100, edgeClock);
drift.finalize(edge, edgeClock);
check('边界值(含)无漂移', edge.totalStressTime === 0 && edge.driftHistory.length === 0,
  `受压时长=${edge.totalStressTime}`);

console.log('=== 4. 漂移后的植株繁育 → 子代继承被环境改写的性状与区间 ===');
const cactus = createBasePlant('cactus');
const mushroom = createBasePlant('mushroom');
book.registerAll([cactus, mushroom]);

const hybrid = Plant.hybridize(sun, cactus);
book.register(hybrid);
const expectedHumidityMin = Math.round((sun.optimalEnv.humidityMin + cactus.optimalEnv.humidityMin) / 2);
check('杂交子代区间来自漂移后的亲本值', hybrid.optimalEnv.humidityMin === expectedHumidityMin,
  `子代湿度下限=${hybrid.optimalEnv.humidityMin}`);
const baseHybridHumidityMin = Math.round((30 + 0) / 2);
check('子代区间不同于未漂移的基础值', hybrid.optimalEnv.humidityMin !== baseHybridHumidityMin,
  `漂移后=${hybrid.optimalEnv.humidityMin}, 若用基础值=${baseHybridHumidityMin}`);

const selfChild = Plant.selfCross(sun);
book.register(selfChild);
check('自交子代完整继承漂移后的区间', JSON.stringify(selfChild.optimalEnv) === JSON.stringify(sun.optimalEnv));
check('自交子代性状基于漂移后取值(突变±30内)',
  Math.abs(selfChild.traits.droughtResistance - sun.traits.droughtResistance) <= 30,
  `亲本=${sun.traits.droughtResistance}, 子代=${selfChild.traits.droughtResistance}`);

console.log('=== 5. 回交区间冲突 → 保留双方来源并可裁决 ===');
const bc = Plant.backcross(cactus, mushroom);
book.register(bc);
check('检测到湿度/光照区间冲突', bc.envOrigin !== null && bc.envOrigin.conflicts.length === 2,
  `冲突: ${bc.envOrigin?.conflicts.map(c => c.dimension).join(', ')}`);
check('双方来源均保留', bc.envOrigin !== null && bc.envOrigin.sources.length === 2 &&
  bc.envOrigin.sources[0].env.humidityMax === 30 && bc.envOrigin.sources[1].env.humidityMin === 60);
const unionEnv = bc.adjudicateEnv('union');
const parentBEnv = bc.adjudicateEnv('parentB');
check('可按并集重新裁决', unionEnv.humidityMin === 0 && unionEnv.humidityMax === 100,
  `并集湿度=[${unionEnv.humidityMin},${unionEnv.humidityMax}]`);
check('可按单方来源重新裁决', parentBEnv.humidityMin === 60 && parentBEnv.humidityMax === 100);
check('默认加权值与并集不同(未静默丢失依据)', bc.optimalEnv.humidityMin !== unionEnv.humidityMin,
  `加权=${bc.optimalEnv.humidityMin}, 并集=${unionEnv.humidityMin}`);

console.log('=== 6. 谱系回溯 → 可追溯到基础植物并标出漂移世代 ===');
const bc2 = Plant.backcross(hybrid, sun);
book.register(bc2);

const traceSelf = book.trace(selfChild.id);
check('自交子代回溯到基础植物', traceSelf.basePlants.length === 1 && traceSelf.basePlants[0].plant.id === sun.id);
check('漂移世代被标出', traceSelf.driftGenerations.some(n => n.plant.id === sun.id),
  `漂移世代: ${traceSelf.driftGenerations.map(n => `G${n.plant.generation}`).join(', ')}`);
check('自交子代无断链', traceSelf.brokenLinks.length === 0);

const traceBc = book.trace(bc.id);
check('回交子代回溯到两个基础植物', traceBc.basePlants.length === 2, traceBc.basePlants.map(n => n.plant.name).join(', '));
check('回交子代无断链', traceBc.brokenLinks.length === 0);

const traceBc2 = book.trace(bc2.id);
const nodeIds = traceBc2.nodes.map(n => n.plant.id);
check('共同祖先只计入一次', new Set(nodeIds).size === nodeIds.length && traceBc2.sharedAncestors.includes(sun.id),
  `共同祖先=${traceBc2.sharedAncestors.length}个, 节点=${nodeIds.length}个均唯一`);
check('回交链上漂移世代可定位', traceBc2.driftGenerations.some(n => n.plant.id === sun.id));
check('累积漂移量可量化', traceBc2.totalDriftMagnitude > 0,
  `链上累计漂移量=${traceBc2.totalDriftMagnitude.toFixed(2)}`);

console.log('');
console.log(book.formatTrace(bc2.id));

console.log('=== 7. 与动态环境系统集成 ===');
const envSys = new EnvironmentSystem();
envSys.state.targetTemperature = 40;
envSys.state.targetHumidity = 0;
envSys.state.targetLight = 100;
envSys.changeInterval = Number.MAX_SAFE_INTEGER;
const mush = createBasePlant('mushroom');
book.register(mush);
let simTime = 0;
for (let i = 0; i < 300; i++) {
  simTime += 1;
  envSys.update(1, simTime * 1000);
  drift.update(mush, envSys.state, 1, simTime);
}
drift.finalize(mush, simTime);
check('波动环境下蘑菇(喜湿凉)产生漂移', mush.totalStressTime > 0 && mush.hasEnvironmentalDrift(),
  `受压=${mush.totalStressTime.toFixed(0)}s, 耐旱 ${60} → ${mush.traits.droughtResistance}`);

console.log('=== 8. JSON 导出/导入保留漂移与来源数据 ===');
const restored = Plant.fromJSON(JSON.parse(JSON.stringify(sun.toJSON())));
check('漂移历史完整往返', restored.totalStressTime === 500 && restored.driftHistory.length === 2);
const restoredBc = Plant.fromJSON(JSON.parse(JSON.stringify(bc.toJSON())));
check('区间冲突来源完整往返',
  restoredBc.envOrigin !== null && restoredBc.envOrigin.conflicts.length === 2 &&
  restoredBc.adjudicateEnv('union').humidityMax === 100);

console.log('');
if (failures > 0) {
  console.log(`结果: ${failures} 项检查失败`);
  throw new Error(`${failures} 项检查失败`);
} else {
  console.log('结果: 全部检查通过');
}
