/**
 * 环境适应度计算的唯一入口。
 *
 * 环境系统（EnvironmentSystem）与植物（Plant）都通过本模块计算适应度，
 * 保证同一植物在不同调用路径下得到一致的结果。
 */

export interface EnvironmentConditions {
  temperature: number;
  humidity: number;
  light: number;
}

export interface FitnessRange {
  min: number;
  max: number;
}

export interface FitnessRanges {
  temperature: FitnessRange;
  humidity: FitnessRange;
  light: FitnessRange;
}

const FITNESS_DECAY_RATE = 0.1;

/**
 * 单参数适应度：区间内（含端点）为 1，区间外按距离占区间宽度的比例指数衰减。
 */
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

/**
 * 综合适应度：温度、湿度、光照三项单参数适应度的乘积。
 */
export function calculateEnvironmentFitness(
  conditions: EnvironmentConditions,
  ranges: FitnessRanges
): number {
  const tempFitness = calculateParameterFitness(
    conditions.temperature,
    ranges.temperature.min,
    ranges.temperature.max
  );
  const humidityFitness = calculateParameterFitness(
    conditions.humidity,
    ranges.humidity.min,
    ranges.humidity.max
  );
  const lightFitness = calculateParameterFitness(
    conditions.light,
    ranges.light.min,
    ranges.light.max
  );

  return tempFitness * humidityFitness * lightFitness;
}
