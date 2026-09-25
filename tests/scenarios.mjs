// Shared deterministic scenarios used by both capture-golden.mjs and verify.mjs.
// Math.random is stubbed with a deterministic LCG so runs are reproducible.

export function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s % 2147483648) / 2147483648;
  };
}

export function withSeed(seed, fn) {
  const original = Math.random;
  Math.random = makeRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function snapshot(plant) {
  return {
    name: plant.name,
    traits: { ...plant.traits },
    generation: plant.generation,
    optimalEnv: { ...plant.optimalEnv },
    parentCount: plant.parentIds.length,
    lineageLength: plant.lineage.length,
  };
}

export const FITNESS_CASES = [
  { label: 'all-in-range',        t: 25, h: 50, l: 50 },
  { label: 'all-at-min-boundary', t: 20, h: 40, l: 10 },
  { label: 'all-at-max-boundary', t: 30, h: 60, l: 90 },
  { label: 'temp-just-below',     t: 19.999, h: 50, l: 50 },
  { label: 'temp-just-above',     t: 30.001, h: 50, l: 50 },
  { label: 'temp-far-below',      t: 10, h: 50, l: 50 },
  { label: 'temp-far-above',      t: 40, h: 50, l: 50 },
  { label: 'humidity-zero-below', t: 25, h: 0, l: 50 },
  { label: 'humidity-100-above',  t: 25, h: 100, l: 50 },
  { label: 'light-zero-below',    t: 25, h: 50, l: 0 },
  { label: 'light-100-above',     t: 25, h: 50, l: 100 },
  { label: 'all-below',           t: 10, h: 0, l: 0 },
  { label: 'all-above',           t: 40, h: 100, l: 100 },
];

export const FITNESS_OPTIMAL = {
  temperature: { min: 20, max: 30 },
  humidity: { min: 40, max: 60 },
  light: { min: 10, max: 90 },
};

// Boundary-heavy cases against the cactus envelope (humidityMin = 0, lightMax = 100).
export const FITNESS_CASES_CACTUS = [
  { label: 'cactus-humidity-at-zero-min', t: 30, h: 0, l: 70 },
  { label: 'cactus-light-at-100-max',     t: 30, h: 20, l: 100 },
  { label: 'cactus-all-at-min',           t: 25, h: 0, l: 50 },
  { label: 'cactus-all-at-max',           t: 40, h: 30, l: 100 },
  { label: 'cactus-humidity-below-zero',  t: 30, h: -5, l: 70 },
];

export const FITNESS_OPTIMAL_CACTUS = {
  temperature: { min: 25, max: 40 },
  humidity: { min: 0, max: 30 },
  light: { min: 50, max: 100 },
};

export function runFitnessScenarios(EnvironmentSystem) {
  const out = [];
  const env = new EnvironmentSystem();
  for (const [optimal, cases] of [[FITNESS_OPTIMAL, FITNESS_CASES], [FITNESS_OPTIMAL_CACTUS, FITNESS_CASES_CACTUS]]) {
    for (const c of cases) {
      env.state.temperature = c.t;
      env.state.humidity = c.h;
      env.state.light = c.l;
      out.push({ label: c.label, fitness: env.calculateFitness(optimal) });
    }
  }
  return out;
}

export function runGeneticsScenarios(Plant, createBasePlant) {
  const result = { hybridize: [], selfCross: [], backcross: [], multiGen: [] };

  result.hybridize = withSeed(1001, () => {
    const p1 = createBasePlant('sunflower');
    const p2 = createBasePlant('cactus');
    const children = [];
    for (let i = 0; i < 5; i++) children.push(snapshot(Plant.hybridize(p1, p2)));
    return children;
  });

  result.selfCross = withSeed(2002, () => {
    const plant = createBasePlant('mushroom');
    const children = [];
    let current = plant;
    for (let i = 0; i < 5; i++) {
      const child = Plant.selfCross(current);
      children.push(snapshot(child));
      current = child;
    }
    return children;
  });

  result.backcross = withSeed(3003, () => {
    const parent = createBasePlant('vine');
    const other = createBasePlant('fern');
    const hybrid = Plant.hybridize(parent, other);
    const children = [];
    let current = hybrid;
    for (let i = 0; i < 5; i++) {
      const child = Plant.backcross(current, parent);
      children.push(snapshot(child));
      current = child;
    }
    return children;
  });

  result.multiGen = withSeed(4004, () => {
    const types = ['sunflower', 'cactus', 'mushroom', 'vine', 'fern'];
    let population = types.map(t => createBasePlant(t));
    const history = [];
    for (let gen = 0; gen < 30; gen++) {
      const pick = () => population[Math.floor(Math.random() * population.length)];
      const op = Math.floor(Math.random() * 3);
      let child;
      if (op === 0) {
        child = Plant.hybridize(pick(), pick());
      } else if (op === 1) {
        child = Plant.selfCross(pick());
      } else {
        child = Plant.backcross(pick(), pick());
      }
      history.push(snapshot(child));
      population.push(child);
      if (population.length > 12) population = population.slice(-12);
    }
    return history;
  });

  return result;
}
