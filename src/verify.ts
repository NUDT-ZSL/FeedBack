import { Ecosystem } from './ecosystem';
import {
  Animal,
  AnimalType,
  ALL_ANIMALS,
  ANIMAL_CONFIG,
  MAX_ENERGY,
  METABOLISM_RATE,
  PREDATION_ENERGY_RATIO,
} from './types';

const FRAME = 1 / 60;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.error(`  \u2717 ${message}`);
  }
}

function approx(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function herbivoreEnergyAfterVitals(startEnergy: number, type: AnimalType, plantDensity: number): number {
  const gain = plantDensity * ANIMAL_CONFIG[type].feedingRate * FRAME * 60;
  const cost = METABOLISM_RATE * FRAME * 60;
  return Math.max(0, Math.min(MAX_ENERGY, startEnergy + gain - cost));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spawn(
  eco: Ecosystem,
  type: AnimalType,
  x: number,
  y: number,
  overrides: Partial<Animal> = {},
): Animal {
  const internal = eco as unknown as {
    addAnimal(type: AnimalType): void;
  };
  internal.addAnimal(type);
  const animal = eco.getAnimals()[eco.getAnimals().length - 1];
  animal.x = x;
  animal.y = y;
  animal.vx = 0;
  animal.vy = 0;
  Object.assign(animal, overrides);
  return animal;
}

function scenarioEnergyDepletionDeath(): void {
  console.log('\n[1] 能量耗尽触发死亡');
  const eco = new Ecosystem(0, () => 0.5);
  eco.setParams({ temperature: 50, precipitation: 0, light: 0, pollution: 100 });

  const rabbit = spawn(eco, 'rabbit', 100, 100, { energy: 0.05, hunger: 0 });

  eco.update(FRAME);

  assert(rabbit.isDying, '能量耗尽的兔子进入死亡状态');
  assert(approx(rabbit.energy, 0), '能量被钳制为 0，不为负');
  assert(eco.getPopulationStats().rabbit === 0, '死亡动画中的兔子不计入存活统计');

  const other = spawn(eco, 'sheep', 300, 300, { energy: MAX_ENERGY, hunger: 99.99 });
  eco.update(FRAME);
  assert(other.isDying, '饥饿值达到上限同样触发死亡');
  assert(eco.getPopulationStats().sheep === 0, '饥饿死亡个体不计入存活统计');

  const wolf = spawn(eco, 'wolf', 400, 400, { hunger: 60, energy: 50 });
  eco.update(FRAME);
  assert(!wolf.isDying, '死亡个体不会被重新选中为活跃目标，其他个体正常推进');
}

function scenarioPredationEnergyTransfer(): void {
  console.log('\n[2] 捕食能量转移');
  const eco = new Ecosystem(0, () => 0.5);
  eco.setParams({ temperature: 20, precipitation: 250, light: 50, pollution: 10 });

  const preyEnergy = 80;
  const wolfStartEnergy = 10;
  const wolf = spawn(eco, 'wolf', 100, 100, { hunger: 50, energy: wolfStartEnergy });
  const rabbit = spawn(eco, 'rabbit', 105, 100, { energy: preyEnergy, hunger: 30 });

  eco.update(FRAME);

  const plantDensity = 1 * (250 / 500) * (50 / 100) * (1 - 10 / 100);
  const preyRemaining = herbivoreEnergyAfterVitals(preyEnergy, 'rabbit', plantDensity);
  const expectedWolfEnergy = Math.min(
    MAX_ENERGY,
    wolfStartEnergy - METABOLISM_RATE * FRAME * 60 + preyRemaining * PREDATION_ENERGY_RATIO,
  );
  assert(approx(wolf.energy, expectedWolfEnergy, 1e-9), `捕食者获得被捕食者剩余能量的 ${PREDATION_ENERGY_RATIO * 100}%`);
  assert(rabbit.isDying, '被捕食者立即进入死亡动画并退出活跃模拟');
  assert(eco.getPopulationStats().rabbit === 0, '被捕食者不计入兔子存活数');
  assert(eco.getPopulationStats().wolf === 1, '捕食者计入狼存活数');
  assert(wolf.hunger < 50, '捕食者饥饿度得到恢复');

  for (let i = 0; i < 5; i++) eco.update(FRAME);
  assert(eco.getPopulationStats().rabbit === 0, '死亡动画持续期间兔子始终不计入存活');
}

function scenarioNoDoubleSettlement(): void {
  console.log('\n[3] 同一帧不重复结算捕食');
  const eco = new Ecosystem(0, () => 0.5);

  const preyEnergy = 80;
  const wolfA = spawn(eco, 'wolf', 100, 100, { hunger: 50, energy: 10 });
  const wolfB = spawn(eco, 'wolf', 110, 100, { hunger: 50, energy: 10 });
  const rabbit = spawn(eco, 'rabbit', 105, 100, { energy: preyEnergy, hunger: 30 });

  eco.update(FRAME);

  assert(rabbit.isDying, '兔子被捕食');
  const fedCount = [wolfA, wolfB].filter((w) => w.energy > 9.99 + 1).length;
  assert(fedCount === 1, '同一帧只有一个捕食者结算了该兔子');
  const totalWolfEnergy = wolfA.energy + wolfB.energy;
  const preyRemaining = herbivoreEnergyAfterVitals(preyEnergy, 'rabbit', eco.getPlantDensity());
  const expectedTotal =
    10 - METABOLISM_RATE * FRAME * 60 + 10 - METABOLISM_RATE * FRAME * 60 + preyRemaining * PREDATION_ENERGY_RATIO;
  assert(approx(totalWolfEnergy, expectedTotal, 1e-9), '被捕食者的能量只转移一次');
  assert(eco.getPopulationStats().rabbit === 0, '存活统计中兔子只减少一个');

  const nextWolf = spawn(eco, 'wolf', 200, 200, { hunger: 50, energy: 20 });
  const nextRabbit = spawn(eco, 'rabbit', 205, 200, { energy: 40, hunger: 30 });
  eco.update(FRAME);
  assert(!nextRabbit.isDying || nextWolf.energy > 20.5, '下一帧捕食恢复正常结算');
}

function scenarioFinalParamsPerFrame(): void {
  console.log('\n[4] 同帧多次修改环境参数按最终值结算');
  const eco = new Ecosystem(0, () => 0.5);

  const rabbit = spawn(eco, 'rabbit', 100, 100, { energy: 50, hunger: 0 });
  eco.setParams({ temperature: 20, precipitation: 0, light: 0, pollution: 0 });
  eco.setParams({ temperature: 20, precipitation: 100, light: 30, pollution: 50 });
  eco.setParams({ temperature: 20, precipitation: 500, light: 100, pollution: 0 });

  eco.update(FRAME);

  const finalDensity = 1 * (500 / 500) * (100 / 100) * 1;
  const gain = finalDensity * ANIMAL_CONFIG.rabbit.feedingRate * FRAME * 60;
  const cost = METABOLISM_RATE * FRAME * 60;
  const expectedEnergy = 50 + gain - cost;

  assert(approx(rabbit.energy, expectedEnergy, 1e-9), '取食能量按同帧最终参数(密度=1)结算');
  assert(Math.abs(rabbit.energy - (50 - cost)) > 1e-6, '中间参数(密度=0)未被使用');

  const wolf = spawn(eco, 'wolf', 300, 300, { hunger: 50, energy: 30 });
  const prey = spawn(eco, 'rabbit', 305, 300, { energy: 60, hunger: 30 });
  eco.setParams({ temperature: 100 });
  eco.setParams({ temperature: 20 });
  eco.update(FRAME);
  const preyRemaining = herbivoreEnergyAfterVitals(60, 'rabbit', finalDensity);
  assert(prey.isDying && approx(wolf.energy, Math.min(MAX_ENERGY, 30 - cost + preyRemaining * PREDATION_ENERGY_RATIO), 1e-9),
    '捕食结算同样基于同帧最终参数');
}

function scenarioContinuousConsistency(): void {
  console.log('\n[5] 连续推进下能量收支与存活统计自洽');
  const eco = new Ecosystem(80, mulberry32(20261004));

  let prevTotalEnergy = 0;
  let consistent = true;

  for (let frame = 0; frame < 600; frame++) {
    eco.update(FRAME);

    const animals = eco.getAnimals();
    const stats = eco.getPopulationStats();

    let liveCount = 0;
    const liveByType: Record<string, number> = {};
    for (const type of ALL_ANIMALS) liveByType[type] = 0;

    for (const animal of animals) {
      if (animal.isDying) continue;
      liveCount++;
      liveByType[animal.type]++;
      if (animal.energy < 0 || animal.energy > animal.maxEnergy || Number.isNaN(animal.energy)) {
        consistent = false;
      }
    }

    let statsTotal = 0;
    for (const type of ALL_ANIMALS) {
      if (stats[type] !== liveByType[type]) consistent = false;
      statsTotal += stats[type] || 0;
    }
    if (statsTotal !== liveCount) consistent = false;

    const totalEnergy = animals
      .filter((a) => !a.isDying)
      .reduce((sum, a) => sum + a.energy, 0);
    if (frame > 0 && Number.isNaN(totalEnergy)) consistent = false;
    prevTotalEnergy = totalEnergy;
  }

  assert(consistent, '每帧存活数、分物种统计与活跃个体集合一致，能量始终在 [0, maxEnergy] 内');
  const finalStats = eco.getPopulationStats();
  const finalTotal = ALL_ANIMALS.reduce((sum, type) => sum + (finalStats[type] || 0), 0);
  assert(finalTotal > 0, `连续推进 600 帧后仍有存活个体 (存活 ${finalTotal} 只)`);
  console.log(`  - 600 帧后总能量: ${prevTotalEnergy.toFixed(2)}`);
}

console.log('========================================');
console.log(' 生态系统能量收支离线验证');
console.log('========================================');

scenarioEnergyDepletionDeath();
scenarioPredationEnergyTransfer();
scenarioNoDoubleSettlement();
scenarioFinalParamsPerFrame();
scenarioContinuousConsistency();

console.log('\n========================================');
console.log(` 通过 ${passed} 项，失败 ${failed} 项`);
console.log('========================================');

if (failed > 0) {
  throw new Error(`验证失败：${failed} 项断言未通过`);
}
