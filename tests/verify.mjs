// Offline consistency verification for the fitness/genetics refactor.
// Usage: node tests/verify.mjs   (run `npx tsc` first, or use `npm test`)
import { Plant, createBasePlant, BASE_PLANTS } from '../dist/plants.js';
import { EnvironmentSystem } from '../dist/environment.js';
import {
  runFitnessScenarios,
  runGeneticsScenarios,
  FITNESS_CASES,
  FITNESS_OPTIMAL,
  FITNESS_CASES_CACTUS,
  FITNESS_OPTIMAL_CACTUS,
} from './scenarios.mjs';
import { readFileSync } from 'node:fs';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

let failures = 0;

function fail(check, detail) {
  failures++;
  console.error(`FAIL [${check}] ${detail}`);
}

function pass(check, detail) {
  console.log(`PASS [${check}] ${detail}`);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return Object.is(a, b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}

function compareGolden(check, actual, expected) {
  if (!deepEqual(actual, expected)) {
    const max = Math.max(actual?.length ?? 0, expected?.length ?? 0);
    for (let i = 0; i < max; i++) {
      if (!deepEqual(actual?.[i], expected?.[i])) {
        fail(check, `mismatch at index ${i}:\n  expected: ${JSON.stringify(expected?.[i])}\n  actual:   ${JSON.stringify(actual?.[i])}`);
        return;
      }
    }
    fail(check, 'structural mismatch (length or keys differ)');
    return;
  }
  pass(check, `${expected.length} entries identical to pre-refactor baseline`);
}

// --- 1. Environment fitness matches pre-refactor baseline (in-range / out-of-range / boundaries)
compareGolden('fitness.golden', runFitnessScenarios(EnvironmentSystem), golden.fitness);

// --- 2. Genetics match pre-refactor baseline under fixed random sequences
const genetics = runGeneticsScenarios(Plant, createBasePlant);
for (const key of ['hybridize', 'selfCross', 'backcross', 'multiGen']) {
  compareGolden(`genetics.${key}`, genetics[key], golden.genetics[key]);
}

// --- 3. Both call paths (EnvironmentSystem vs Plant) produce identical fitness
{
  const env = new EnvironmentSystem();
  let ok = true;
  for (const [optimal, cases] of [[FITNESS_OPTIMAL, FITNESS_CASES], [FITNESS_OPTIMAL_CACTUS, FITNESS_CASES_CACTUS]]) {
    const plant = new Plant({ color: 1, shape: 1, height: 1, droughtResistance: 1 }, 0, [], [], {
      tempMin: optimal.temperature.min, tempMax: optimal.temperature.max,
      humidityMin: optimal.humidity.min, humidityMax: optimal.humidity.max,
      lightMin: optimal.light.min, lightMax: optimal.light.max,
    });
    for (const c of cases) {
      env.state.temperature = c.t;
      env.state.humidity = c.h;
      env.state.light = c.l;
      const viaEnv = env.calculateFitness(optimal);
      const viaPlant = plant.calculateFitness({ temperature: c.t, humidity: c.h, light: c.l });
      if (viaEnv !== viaPlant) {
        fail('fitness.cross-path', `${c.label}: env=${viaEnv} plant=${viaPlant}`);
        ok = false;
      }
    }
  }
  if (ok) pass('fitness.cross-path', 'EnvironmentSystem and Plant paths agree on all cases');
}

// --- 4. Boundary semantics: endpoints are inclusive, 0/100 humidity handled
{
  const env = new EnvironmentSystem();
  const optimal = FITNESS_OPTIMAL;
  const at = (t, h, l) => {
    env.state.temperature = t; env.state.humidity = h; env.state.light = l;
    return env.calculateFitness(optimal);
  };
  const checks = [
    ['temp == min boundary', at(20, 50, 50) === 1],
    ['temp == max boundary', at(30, 50, 50) === 1],
    ['humidity == min boundary', at(25, 40, 50) === 1],
    ['humidity == max boundary', at(25, 60, 50) === 1],
    ['light == min boundary', at(25, 50, 10) === 1],
    ['light == max boundary', at(25, 50, 90) === 1],
    ['just outside max < 1', at(30.0001, 50, 50) < 1],
    ['just below min < 1', at(19.9999, 50, 50) < 1],
  ];
  // humidity 0 / 100 against the cactus envelope (humidityMin = 0)
  const cactus = FITNESS_OPTIMAL_CACTUS;
  const atCactus = (t, h, l) => {
    env.state.temperature = t; env.state.humidity = h; env.state.light = l;
    return env.calculateFitness(cactus);
  };
  checks.push(
    ['humidity 0 in-range when min=0', atCactus(30, 0, 70) === 1],
    ['humidity 100 out-of-range decays', atCactus(30, 100, 70) > 0 && atCactus(30, 100, 70) < 1],
    ['light 100 at max boundary', atCactus(30, 20, 100) === 1],
  );
  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length) bad.forEach(([name]) => fail('fitness.boundary', name));
  else pass('fitness.boundary', `${checks.length} boundary assertions hold`);
}

// --- 5. Multi-generation sanity: offspring optimalEnv stays within the base-plant envelope
{
  const mins = { tempMin: Infinity, humidityMin: Infinity, lightMin: Infinity };
  const maxs = { tempMax: -Infinity, humidityMax: -Infinity, lightMax: -Infinity };
  for (const cfg of Object.values(BASE_PLANTS)) {
    mins.tempMin = Math.min(mins.tempMin, cfg.optimalEnv.tempMin);
    mins.humidityMin = Math.min(mins.humidityMin, cfg.optimalEnv.humidityMin);
    mins.lightMin = Math.min(mins.lightMin, cfg.optimalEnv.lightMin);
    maxs.tempMax = Math.max(maxs.tempMax, cfg.optimalEnv.tempMax);
    maxs.humidityMax = Math.max(maxs.humidityMax, cfg.optimalEnv.humidityMax);
    maxs.lightMax = Math.max(maxs.lightMax, cfg.optimalEnv.lightMax);
  }
  const problems = [];
  genetics.multiGen.forEach((child, i) => {
    const e = child.optimalEnv;
    if (!(e.tempMin <= e.tempMax && e.humidityMin <= e.humidityMax && e.lightMin <= e.lightMax)) {
      problems.push(`gen ${i}: min>max in ${JSON.stringify(e)}`);
    }
    if (e.tempMin < mins.tempMin || e.tempMax > maxs.tempMax ||
        e.humidityMin < mins.humidityMin || e.humidityMax > maxs.humidityMax ||
        e.lightMin < mins.lightMin || e.lightMax > maxs.lightMax) {
      problems.push(`gen ${i}: outside base-plant envelope ${JSON.stringify(e)}`);
    }
    for (const v of Object.values(child.traits)) {
      if (!Number.isInteger(v) || v < 0 || v > 255) problems.push(`gen ${i}: trait out of range ${JSON.stringify(child.traits)}`);
    }
  });
  if (problems.length) problems.forEach(p => fail('genetics.envelope', p));
  else pass('genetics.envelope', `30 generations stay within envelope temp[${mins.tempMin},${maxs.tempMax}] humidity[${mins.humidityMin},${maxs.humidityMax}] light[${mins.lightMin},${maxs.lightMax}]`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
