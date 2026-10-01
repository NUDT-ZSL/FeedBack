import { v4 as uuidv4 } from 'uuid';
import type { Particle, FlourOutput, FlourType } from './types';

export const calculateWheelSpeed = (valveOpening: number): number => {
  return Math.max(0, Math.min(100, valveOpening)) * 0.6;
};

export const calculateLoad = (gap: number, speed: number): number => {
  const baseLoad = 50;
  const adjustFactor = 0.3;
  const load = (baseLoad / (gap * gap)) * (speed / 100) * adjustFactor;
  return Math.min(100, Math.max(0, load * 100));
};

export const isOverloaded = (load: number): boolean => {
  return load > 85;
};

export const getFlourFineness = (gap: number): 'fine' | 'medium' | 'coarse' => {
  if (gap < 1) return 'fine';
  if (gap < 2) return 'medium';
  return 'coarse';
};

export const calculateFlourOutput = (
  gap: number,
  speed: number,
  dt: number
): FlourOutput => {
  const baseRate = speed * 0.01 * 0.5;
  const totalOutput = baseRate * dt;

  let fineRatio: number, mediumRatio: number, branRatio: number;

  if (gap < 1) {
    fineRatio = 0.6;
    mediumRatio = 0.3;
    branRatio = 0.1;
  } else if (gap < 2) {
    fineRatio = 0.3;
    mediumRatio = 0.5;
    branRatio = 0.2;
  } else {
    fineRatio = 0.1;
    mediumRatio = 0.4;
    branRatio = 0.5;
  }

  return {
    fine: totalOutput * fineRatio,
    medium: totalOutput * mediumRatio,
    bran: totalOutput * branRatio,
  };
};

export const createParticle = (x: number, y: number): Particle => {
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.5 + Math.random() * 1.5;
  return {
    id: uuidv4(),
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 1,
    size: 3 + Math.random() * 3,
    opacity: 0.8,
    life: 1,
  };
};

export const updateParticle = (
  particle: Particle,
  dt: number
): Particle | null => {
  const gravity = 0.1;
  const newVy = particle.vy + gravity * dt * 60;
  const newLife = particle.life - dt * 0.8;

  if (newLife <= 0) {
    return null;
  }

  return {
    ...particle,
    x: particle.x + particle.vx * dt * 60,
    y: particle.y + newVy * dt * 60,
    vy: newVy,
    opacity: newLife * 0.8,
    life: newLife,
  };
};

export const getFlourTypeName = (type: FlourType): string => {
  const names: Record<FlourType, string> = {
    fine: '精白面',
    medium: '中筋面',
    bran: '麸皮',
  };
  return names[type];
};

export const getFlourTypeColor = (type: FlourType): string => {
  const colors: Record<FlourType, string> = {
    fine: '#faf8f0',
    medium: '#f5e6c8',
    bran: '#d4a574',
  };
  return colors[type];
};

export const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};
