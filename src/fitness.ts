export interface FitnessRange {
  min: number;
  max: number;
}

export interface FitnessEnvironmentValues {
  temperature: number;
  humidity: number;
  light: number;
}

export interface FitnessOptimalRanges {
  temperature: FitnessRange;
  humidity: FitnessRange;
  light: FitnessRange;
}

export interface FlatOptimalEnvironment {
  tempMin: number;
  tempMax: number;
  humidityMin: number;
  humidityMax: number;
  lightMin: number;
  lightMax: number;
}

export const FITNESS_DECAY_RATE = 0.1;

export function calculateParameterFitness(
  value: number,
  min: number,
  max: number
): number {
  if (value >= min && value <= max) {
    return 1;
  }

  const range = max - min;
  const distance = value < min ? min - value : value - max;
  const fitness = Math.exp(-FITNESS_DECAY_RATE * (distance / range));
  return Math.max(0, fitness);
}

function isFlatOptimalEnvironment(
  optimalEnv: FitnessOptimalRanges | FlatOptimalEnvironment
): optimalEnv is FlatOptimalEnvironment {
  return 'tempMin' in optimalEnv;
}

function getRange(
  parameter: keyof FitnessOptimalRanges,
  optimalEnv: FitnessOptimalRanges | FlatOptimalEnvironment
): FitnessRange {
  if (isFlatOptimalEnvironment(optimalEnv)) {
    if (parameter === 'temperature') {
      return { min: optimalEnv.tempMin, max: optimalEnv.tempMax };
    }
    if (parameter === 'humidity') {
      return { min: optimalEnv.humidityMin, max: optimalEnv.humidityMax };
    }
    return { min: optimalEnv.lightMin, max: optimalEnv.lightMax };
  }

  return optimalEnv[parameter];
}

export function calculateEnvironmentalFitness(
  environment: FitnessEnvironmentValues,
  optimalEnv: FitnessOptimalRanges | FlatOptimalEnvironment
): number {
  const parameters: (keyof FitnessOptimalRanges)[] = ['temperature', 'humidity', 'light'];

  return parameters.reduce((result, parameter) => {
    const range = getRange(parameter, optimalEnv);
    return result * calculateParameterFitness(environment[parameter], range.min, range.max);
  }, 1);
}
