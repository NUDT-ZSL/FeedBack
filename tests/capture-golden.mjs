// Captures the golden baseline from the CURRENT compiled code in dist/.
// Run this against the ORIGINAL (pre-refactor) build to produce tests/golden.json.
import { Plant, createBasePlant } from '../dist/plants.js';
import { EnvironmentSystem } from '../dist/environment.js';
import { runFitnessScenarios, runGeneticsScenarios } from './scenarios.mjs';
import { writeFileSync } from 'node:fs';

const golden = {
  fitness: runFitnessScenarios(EnvironmentSystem),
  genetics: runGeneticsScenarios(Plant, createBasePlant),
};

writeFileSync(new URL('./golden.json', import.meta.url), JSON.stringify(golden, null, 2));
console.log('golden.json written:',
  golden.fitness.length, 'fitness cases,',
  golden.genetics.hybridize.length, 'hybridize,',
  golden.genetics.selfCross.length, 'selfCross,',
  golden.genetics.backcross.length, 'backcross,',
  golden.genetics.multiGen.length, 'multiGen');
