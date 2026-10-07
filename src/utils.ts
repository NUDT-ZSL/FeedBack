export {
  hasGeneratingCombination,
  getBeamElements,
  mixFireColor,
  calculateFlameHeight,
  blendColors
} from './engine/derive.ts';

export function getSmokeColor(temperature: number): string {
  if (temperature < 33) {
    const t = temperature / 33;
    return `rgba(200, 200, 200, ${0.3 + t * 0.3})`;
  } else if (temperature < 66) {
    const t = (temperature - 33) / 33;
    const r = Math.round(255 * (1 - t * 0.3));
    const g = Math.round(150 * (1 - t * 0.5));
    const b = Math.round(50 * (1 - t));
    return `rgba(${r}, ${g}, ${b}, 0.6)`;
  } else {
    const t = (temperature - 66) / 34;
    const r = Math.round(50 * (1 - t * 0.8));
    const g = Math.round(150 + t * 105);
    const b = Math.round(200 + t * 55);
    return `rgba(${r}, ${g}, ${b}, 0.7)`;
  }
}

export function getParticleRate(temperature: number): number {
  return 40 + (temperature / 100) * 40;
}

export function getTemperatureFromFlameColor(color: string): number {
  const hex = color.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  if (b > 150) return 80 + Math.random() * 20;
  if (r > 200 && g < 100) return 40 + Math.random() * 30;
  return 10 + Math.random() * 30;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
