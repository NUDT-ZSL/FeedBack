import assert from 'node:assert/strict';

import { BASE_PLANTS, Plant, createBasePlant } from '../verify-dist/plants.js';
import {
  calculateEnvironmentalFitness,
  calculateParameterFitness,
} from '../verify-dist/fitness.js';
import { EnvironmentSystem } from '../verify-dist/environment.js';

const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

function withRandomValues(values, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    if (index >= values.length) {
      throw new Error(`Random sequence exhausted at ${index}`);
    }
    return values[index++];
  };

  try {
    return fn();
  } finally {
    Math.random = originalRandom;
    if (index !== values.length) {
      throw new Error(`Random sequence changed: used ${index}/${values.length}`);
    }
  }
}

check('hybridize preserves fixed-sequence traits and optimal environment', () => {
  const sunflower = createBasePlant('sunflower');
  const cactus = createBasePlant('cactus');
  const child = withRandomValues(
    [0.4, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.25, 0.75, 0.1, 0, 0, 0],
    () => Plant.hybridize(sunflower, cactus)
  );

  assert.deepEqual(child.traits, {
    color: 134, shape: 60, height: 200, droughtResistance: 160,
  });
  assert.deepEqual(child.optimalEnv, {
    tempMin: 23, tempMax: 38, humidityMin: 15, humidityMax: 50,
    lightMin: 55, lightMax: 100,
  });
  assert.equal(child.generation, 1);
  assert.deepEqual(child.parentIds, [sunflower.id, cactus.id]);
});

check('selfCross preserves fixed-sequence mutation and copied environment', () => {
  const sunflower = createBasePlant('sunflower');
  const originalEnv = { ...sunflower.optimalEnv };
  const child = withRandomValues(
    [0.04, 0.9, 0.8, 0.8, 0.04, 0.1, 0, 0, 0],
    () => Plant.selfCross(sunflower)
  );

  assert.deepEqual(child.traits, {
    color: 244, shape: 180, height: 200, droughtResistance: 76,
  });
  assert.deepEqual(child.optimalEnv, originalEnv);
  assert.notEqual(child.optimalEnv, sunflower.optimalEnv);
});

check('backcross preserves fixed-sequence parent bias and environment weights', () => {
  const sunflower = createBasePlant('sunflower');
  const cactus = createBasePlant('cactus');
  const child = withRandomValues(
    [0.1, 0.7, 0.2, 0.8, 0, 0, 0],
    () => Plant.backcross(sunflower, cactus)
  );

  assert.deepEqual(child.traits, {
    color: 80, shape: 180, height: 50, droughtResistance: 100,
  });
  assert.deepEqual(child.optimalEnv, {
    tempMin: 23, tempMax: 38, humidityMin: 12, humidityMax: 46,
    lightMin: 54, lightMax: 100,
  });
});

check('parameter fitness matches in-range, endpoint, and humidity 0/100 behavior', () => {
  assert.equal(calculateParameterFitness(20, 20, 35), 1);
  assert.equal(calculateParameterFitness(35, 20, 35), 1);
  assert.equal(calculateParameterFitness(15, 20, 35), Math.exp(-0.1 * (5 / 15)));
  assert.equal(calculateParameterFitness(40, 20, 35), Math.exp(-0.1 * (5 / 15)));
  assert.equal(calculateParameterFitness(0, 0, 100), 1);
  assert.equal(calculateParameterFitness(100, 0, 100), 1);
  assert.equal(calculateParameterFitness(-5, 0, 100), Math.exp(-0.1 * (5 / 100)));
  assert.equal(calculateParameterFitness(105, 0, 100), Math.exp(-0.1 * (5 / 100)));
});

check('flat and nested optimal environments share one fitness calculation', () => {
  const state = { temperature: 15, humidity: 0, light: 0 };
  const sunflower = createBasePlant('sunflower');
  const nested = {
    temperature: { min: 20, max: 35 },
    humidity: { min: 30, max: 70 },
    light: { min: 60, max: 100 },
  };
  const expected = 0.772337743280081;

  assert.equal(calculateEnvironmentalFitness(state, sunflower.optimalEnv), expected);
  assert.equal(calculateEnvironmentalFitness(state, nested), expected);
  assert.equal(sunflower.calculateFitness(state), expected);

  const system = new EnvironmentSystem();
  system.state = {
    ...state,
    targetTemperature: 15,
    targetHumidity: 0,
    targetLight: 0,
  };
  assert.equal(system.calculateFitness(nested), expected);
});

check('30 generations keep optimal environments within base-plant bounds', () => {
  let seed = 0x2545f4;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const bounds = {};
  for (const config of Object.values(BASE_PLANTS)) {
    for (const [key, value] of Object.entries(config.optimalEnv)) {
      bounds[key] ??= { min: value, max: value };
      bounds[key].min = Math.min(bounds[key].min, value);
      bounds[key].max = Math.max(bounds[key].max, value);
    }
  }

  let a = createBasePlant('sunflower');
  let b = createBasePlant('mushroom');
  for (let generation = 1; generation <= 30; generation++) {
    const child = random() < 0.5
      ? Plant.hybridize(a, b)
      : random() < 0.5
        ? Plant.selfCross(a)
        : Plant.backcross(a, b);

    for (const [key, bound] of Object.entries(bounds)) {
      const value = child.optimalEnv[key];
      assert.ok(
        value >= bound.min && value <= bound.max,
        `generation ${generation} ${key}=${value} outside [${bound.min}, ${bound.max}]`
      );
    }
    assert.ok(child.optimalEnv.tempMin <= child.optimalEnv.tempMax);
    assert.ok(child.optimalEnv.humidityMin <= child.optimalEnv.humidityMax);
    assert.ok(child.optimalEnv.lightMin <= child.optimalEnv.lightMax);
    assert.ok(child.optimalEnv.humidityMin >= 0 && child.optimalEnv.humidityMax <= 100);
    assert.ok(child.optimalEnv.lightMin >= 0 && child.optimalEnv.lightMax <= 100);
    a = child;
  }
});

let failures = 0;
for (const { name, fn } of checks) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} consistency check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} offline consistency checks passed.`);
