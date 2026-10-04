import { Ecosystem } from '../src/ecosystem';
import {
  ALL_ANIMALS,
  ANIMAL_CONFIG,
  ENERGY_TRANSFER_RATIO,
  METABOLIC_DRAIN_SCALE,
  AnimalType,
} from '../src/types';

declare const process: { exitCode: number };

const DT = 1 / 60;
let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  [PASS] ${name}`);
  } else {
    failures++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function approx(actual: number, expected: number, eps = 1e-9): boolean {
  return Math.abs(actual - expected) <= eps;
}

function drainOf(type: AnimalType): number {
  return ANIMAL_CONFIG[type].hungerRate * METABOLIC_DRAIN_SCALE * DT;
}

function makeEcosystem(): Ecosystem {
  const eco = new Ecosystem(0);
  eco.autoRespawn = false;
  return eco;
}

function scenarioEnergyDepletion(): void {
  console.log('\n场景1: 能量耗尽与饥饿上限触发死亡，死亡动画不计入存活统计');

  const eco = makeEcosystem();
  eco.setParams({ temperature: 20, precipitation: 0, light: 0, pollution: 0 });
  const rabbit = eco.addAnimal('rabbit', 100, 100);
  rabbit.energy = 0.5;
  rabbit.hunger = 0;

  let sawDying = false;
  let dyingCountedAlive = false;
  for (let i = 0; i < 600; i++) {
    eco.update(DT);
    if (rabbit.isDying) {
      sawDying = true;
      if (eco.getPopulationStats().rabbit !== 0) dyingCountedAlive = true;
    }
  }

  check('能量耗尽触发死亡动画', sawDying);
  check('死亡动画期间不计入存活统计', !dyingCountedAlive);
  check('动画结束后个体被移除', eco.getAnimals().length === 0);
  check('移除后存活统计为 0', eco.getPopulationStats().rabbit === 0);

  const eco2 = makeEcosystem();
  eco2.setParams({ light: 0, precipitation: 0 });
  const hungry = eco2.addAnimal('rabbit', 100, 100);
  hungry.energy = hungry.maxEnergy;
  hungry.hunger = hungry.maxHunger - 0.05;
  eco2.update(DT);
  check('饥饿值达到上限同样触发死亡', hungry.isDying);
  check('饥饿死亡个体不计入存活统计', eco2.getPopulationStats().rabbit === 0);
}

function scenarioPredationTransfer(): void {
  console.log('\n场景2: 捕食成功按固定比例转移被捕食者剩余能量，被捕食者立即退出');

  const eco = makeEcosystem();
  eco.setParams({ light: 0, precipitation: 0 });
  const wolf = eco.addAnimal('wolf', 400, 400);
  const rabbit = eco.addAnimal('rabbit', 405, 400);
  wolf.hunger = 50;
  wolf.energy = 100;
  rabbit.hunger = 0;
  rabbit.energy = 40;

  eco.update(DT);

  const preyEnergyAtPredation = 40 - drainOf('rabbit');
  const expectedWolf = Math.min(
    wolf.maxEnergy,
    100 - drainOf('wolf') + preyEnergyAtPredation * ENERGY_TRANSFER_RATIO,
  );

  check('被捕食者立即退出模拟', !eco.getAnimals().includes(rabbit));
  check('捕食者获得固定比例能量', approx(wolf.energy, expectedWolf, 1e-9),
    `expected=${expectedWolf}, actual=${wolf.energy}`);
  check('捕食者能量不超过上限', wolf.energy <= wolf.maxEnergy);
  check('被捕食者不计入存活统计', eco.getPopulationStats().rabbit === 0);
  check('捕食者计入存活统计', eco.getPopulationStats().wolf === 1);
  check('弹出一次能量提示', eco.getFloatingTexts().length === 1);
}

function scenarioDuplicateSettlement(): void {
  console.log('\n场景3: 同一帧内一个个体不会被多个捕食者重复结算');

  const eco = makeEcosystem();
  eco.setParams({ light: 0, precipitation: 0 });
  const wolf1 = eco.addAnimal('wolf', 400, 400);
  const wolf2 = eco.addAnimal('wolf', 404, 400);
  const rabbit = eco.addAnimal('rabbit', 402, 400);
  for (const wolf of [wolf1, wolf2]) {
    wolf.hunger = 50;
    wolf.energy = 100;
  }
  rabbit.hunger = 0;
  rabbit.energy = 40;

  eco.update(DT);

  const drain = drainOf('wolf');
  const gainers = [wolf1, wolf2].filter(w => w.energy > 100 - drain + 1e-9);

  check('被捕食者只退出一次', !eco.getAnimals().includes(rabbit));
  check('恰好一个捕食者获得能量', gainers.length === 1, `gainers=${gainers.length}`);
  check('另一个捕食者仅有代谢消耗', approx(gainers.length === 1 ? (gainers[0] === wolf1 ? wolf2 : wolf1).energy : 0, 100 - drain, 1e-9));
  check('能量提示只弹出一次', eco.getFloatingTexts().length === 1);

  const eco2 = makeEcosystem();
  eco2.setParams({ light: 0, precipitation: 0 });
  const wolf3 = eco2.addAnimal('wolf', 400, 400);
  const dyingRabbit = eco2.addAnimal('rabbit', 403, 400);
  wolf3.hunger = 50;
  wolf3.energy = 100;
  dyingRabbit.hunger = dyingRabbit.maxHunger - 0.05;
  dyingRabbit.energy = 30;

  eco2.update(DT);

  check('死亡动画中的个体不被捕食者选中', eco2.getFloatingTexts().length === 0
    && approx(wolf3.energy, 100 - drain, 1e-9), `wolf.energy=${wolf3.energy}`);
  check('死亡动画中的个体不计入存活统计', eco2.getPopulationStats().rabbit === 0);
}

function scenarioParamsLastWriteWins(): void {
  console.log('\n场景4: 同帧多次修改环境参数时按最终参数结算取食');

  const eco = makeEcosystem();
  const rabbit = eco.addAnimal('rabbit', 100, 100);
  rabbit.energy = 50;
  rabbit.hunger = 0;

  eco.setParams({ light: 0, precipitation: 0, pollution: 100 });
  eco.setParams({ pollution: 40 });
  eco.setParams({ temperature: 20, precipitation: 500, light: 100, pollution: 0 });

  eco.update(DT);

  const density = eco.getPlantDensity();
  const expected = 50 - drainOf('rabbit') + density * ANIMAL_CONFIG.rabbit.feedingRate * DT;

  check('最终参数在帧内生效', approx(density, 1, 1e-9), `density=${density}`);
  check('取食能量按最终参数结算', approx(rabbit.energy, expected, 1e-9),
    `expected=${expected}, actual=${rabbit.energy}`);
  check('中间参数值不产生效果', rabbit.energy > 50);
  check('getParams 返回最终参数', eco.getParams().pollution === 0 && eco.getParams().light === 100);
}

function scenarioContinuousConsistency(): void {
  console.log('\n场景5: 连续推进下能量收支与存活统计保持自洽');

  const eco = new Ecosystem(80);
  eco.autoRespawn = false;

  let violations = 0;
  let firstViolation = '';

  const record = (msg: string): void => {
    violations++;
    if (!firstViolation) firstViolation = msg;
  };

  for (let frame = 0; frame < 1200; frame++) {
    if (frame === 200) eco.setParams({ pollution: 90, light: 20 });
    if (frame === 500) eco.setParams({ pollution: 0, light: 80, precipitation: 400 });

    eco.update(DT);

    const animals = eco.getAnimals();
    const stats = eco.getPopulationStats();
    const living: Record<string, number> = {};

    for (const animal of animals) {
      if (animal.isDying) continue;
      living[animal.type] = (living[animal.type] || 0) + 1;

      if (!Number.isFinite(animal.energy) || !Number.isFinite(animal.hunger)) {
        record(`frame ${frame}: ${animal.type} 出现非法数值`);
      }
      if (!(animal.energy > 0 && animal.energy <= animal.maxEnergy + 1e-9)) {
        record(`frame ${frame}: ${animal.type} 存活个体能量越界 (${animal.energy}/${animal.maxEnergy})`);
      }
      if (!(animal.hunger >= 0 && animal.hunger < animal.maxHunger)) {
        record(`frame ${frame}: ${animal.type} 存活个体饥饿值越界 (${animal.hunger})`);
      }
    }

    for (const type of ALL_ANIMALS) {
      if ((stats[type] || 0) !== (living[type] || 0)) {
        record(`frame ${frame}: ${type} 统计 ${stats[type]} != 实际存活 ${living[type] || 0}`);
      }
    }
  }

  check('1200 帧内统计与存活口径始终一致', violations === 0, firstViolation);
  console.log(`  [INFO] 推进结束: 存活 ${eco.getAnimals().filter(a => !a.isDying).length} 只, 统计总和 ${
    ALL_ANIMALS.reduce((sum, t) => sum + (eco.getPopulationStats()[t] || 0), 0)}`);
}

console.log('开始能量收支机制离线验证');
scenarioEnergyDepletion();
scenarioPredationTransfer();
scenarioDuplicateSettlement();
scenarioParamsLastWriteWins();
scenarioContinuousConsistency();

console.log(failures === 0 ? '\n全部验证通过' : `\n共 ${failures} 项验证失败`);
process.exitCode = failures === 0 ? 0 : 1;
