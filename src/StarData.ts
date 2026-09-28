import { Star, SpectralType, SpectralInfo } from './types';

export const SPECTRAL_MAP: Record<SpectralType, SpectralInfo> = {
  O: { color: '#9bb0ff', tempMin: 30000, tempMax: 50000, ratio: 0.001, label: 'O型 - 蓝巨星' },
  B: { color: '#aabfff', tempMin: 10000, tempMax: 30000, ratio: 0.005, label: 'B型 - 蓝白星' },
  A: { color: '#cad7ff', tempMin: 7500, tempMax: 10000, ratio: 0.02, label: 'A型 - 白星' },
  F: { color: '#f8f7ff', tempMin: 6000, tempMax: 7500, ratio: 0.05, label: 'F型 - 黄白星' },
  G: { color: '#fff4ea', tempMin: 5000, tempMax: 6000, ratio: 0.1, label: 'G型 - 黄星' },
  K: { color: '#ffd2a1', tempMin: 3500, tempMax: 5000, ratio: 0.2, label: 'K型 - 橙星' },
  M: { color: '#ffcc6f', tempMin: 2400, tempMax: 3500, ratio: 0.624, label: 'M型 - 红矮星' },
};

const STAR_PREFIXES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Nova', 'Proxima', 'HD', 'Gliese', 'Kepler', 'TRAPPIST', 'Sirius', 'Vega', 'Altair', 'Rigel', 'Betelgeuse', 'Polaris'];
const STAR_SUFFIXES = ['Centauri', 'Eridani', 'Tauri', 'Orionis', 'Cygni', 'Lyrae', 'Aquilae', 'Leonis', 'Draconis', 'Bootis', 'I', 'II', 'III', 'IV', 'V', 'A', 'B', 'C'];

function randomName(index: number): string {
  const prefix = STAR_PREFIXES[Math.floor(Math.random() * STAR_PREFIXES.length)];
  const suffix = STAR_SUFFIXES[Math.floor(Math.random() * STAR_SUFFIXES.length)];
  const num = Math.floor(Math.random() * 999) + 1;
  return `${prefix} ${suffix} ${num}`;
}

function getRandomSpectralType(): SpectralType {
  const rand = Math.random();
  let cumulative = 0;
  const types: SpectralType[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];
  
  for (const type of types) {
    cumulative += SPECTRAL_MAP[type].ratio;
    if (rand < cumulative) {
      return type;
    }
  }
  return 'M';
}

function generateSpiralArm(armAngle: number, armTightness: number, count: number, armWidth: number, ySpread: number): { x: number; y: number; z: number }[] {
  const positions: { x: number; y: number; z: number }[] = [];
  
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const distance = t * 35 + 5;
    const angle = armAngle + distance * armTightness + (Math.random() - 0.5) * armWidth;
    const radius = distance;
    const x = Math.cos(angle) * radius + (Math.random() - 0.5) * armWidth * 2;
    const z = Math.sin(angle) * radius + (Math.random() - 0.5) * armWidth * 2;
    const y = (Math.random() - 0.5) * ySpread * (1 - t * 0.5);
    
    positions.push({ x, y, z });
  }
  
  return positions;
}

export function generateStars(count: number = 3000): Star[] {
  const stars: Star[] = [];
  
  const arm1Count = Math.floor(count * 0.4);
  const arm2Count = Math.floor(count * 0.35);
  const coreCount = count - arm1Count - arm2Count;
  
  const arm1Positions = generateSpiralArm(0, 0.4, arm1Count, 3, 4);
  const arm2Positions = generateSpiralArm(Math.PI, 0.4, arm2Count, 3, 4);
  
  const corePositions: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < coreCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.pow(Math.random(), 0.5) * 8;
    corePositions.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta) * 0.4,
      z: r * Math.cos(phi),
    });
  }
  
  const allPositions = [...arm1Positions, ...arm2Positions, ...corePositions];
  
  for (let i = 0; i < count; i++) {
    const spectralType = getRandomSpectralType();
    const info = SPECTRAL_MAP[spectralType];
    const temperature = info.tempMin + Math.random() * (info.tempMax - info.tempMin);
    const apparentMagnitude = -1.5 + Math.random() * 11.5;
    const distance = 80 + Math.random() * 9920;
    
    stars.push({
      id: i,
      name: randomName(i),
      spectralType,
      apparentMagnitude,
      distance,
      temperature: Math.round(temperature),
      position: allPositions[i],
    });
  }
  
  return stars;
}

export const stars = generateStars(3000);
