export function calculateUniformity(positions: { x: number; y: number; t: number }[]): number {
  if (positions.length < 3) return 0;

  const speeds: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const distance = Math.sqrt(Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2));
    const timeDiff = curr.t - prev.t;
    if (timeDiff > 0) {
      speeds.push(distance / timeDiff);
    }
  }

  if (speeds.length < 2) return 0;

  const mean = speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
  if (mean === 0) return 0;

  const variance = speeds.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / speeds.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  const uniformity = Math.max(0, 100 - coefficientOfVariation * 100);
  return Math.min(100, uniformity);
}

export function calculateDryness(currentDryness: number, lightIntensity: number, deltaTime: number): number {
  const rate = 0.01 + (lightIntensity / 100) * 0.01;
  const newDryness = currentDryness + rate * deltaTime;
  return Math.min(100, newDryness);
}

export function calculateFragmentation(hitCount: number): number {
  return Math.floor(hitCount / 5) * 10;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
