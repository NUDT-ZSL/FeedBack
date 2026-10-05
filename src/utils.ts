import type { PulpState, QualityGrade } from './types';
import {
  calculateBreakProbability as engineBreakProbability,
  calculateConcentration as engineConcentration,
  calculateUniformity as engineUniformity,
  calculateQualityScore as engineQualityScore,
  clamp as engineClamp,
} from './simulation/engine';

export const calculateBreakProbability = (
  uniformity: number,
  dryness: number
): number => engineBreakProbability(uniformity, dryness);

export const calculateUniformity = (concentration: number): number =>
  engineUniformity(concentration, Math.random);

export const calculateDryingTime = (pressLevel: number): number => {
  const baseTime = 4000;
  const reduction = pressLevel * 20;
  return Math.max(2000, baseTime - reduction);
};

export const calculateQualityScore = (
  concentration: number,
  uniformity: number,
  dryness: number,
  pressLevel: number,
  inspectionPoints: number
): { score: number; grade: QualityGrade } => {
  const { score, grade } = engineQualityScore(
    concentration,
    uniformity,
    dryness,
    pressLevel,
    inspectionPoints
  );
  return { score, grade };
};

export const getGradeColor = (grade: QualityGrade): string => {
  switch (grade) {
    case 'excellent':
      return '#ffd700';
    case 'good':
      return '#c0c0c0';
    case 'medium':
      return '#cd7f32';
    default:
      return 'transparent';
  }
};

export const getGradeLabel = (grade: QualityGrade): string => {
  switch (grade) {
    case 'excellent':
      return '优';
    case 'good':
      return '良';
    case 'medium':
      return '中';
    default:
      return '差';
  }
};

export const getMaterialLabel = (material: string): string => {
  switch (material) {
    case 'chuPi':
      return '楮皮';
    case 'sangPi':
      return '桑皮';
    case 'maXianWei':
      return '麻纤维';
    default:
      return material;
  }
};

export const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export const clamp = (value: number, min: number, max: number): number =>
  engineClamp(value, min, max);

export const calculateConcentration = (materials: PulpState['materials']): number =>
  engineConcentration(materials);

export const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const getPaperColorByDryness = (dryness: number): string => {
  if (dryness < 30) return '#e8e4dc';
  if (dryness < 60) return '#f0e8d8';
  if (dryness < 90) return '#f5e6cc';
  return '#f5e6cc';
};
