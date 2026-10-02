import type { PulpState, QualityGrade } from './types';

export const calculateUniformity = (concentration: number): number => {
  const optimalConcentration = 50;
  const deviation = Math.abs(concentration - optimalConcentration);
  const baseScore = Math.max(0, 100 - deviation * 1.5);
  const randomFactor = Math.random() * 10 - 5;
  return Math.max(0, Math.min(100, baseScore + randomFactor));
};

export const calculateDryingTime = (pressLevel: number): number => {
  const baseTime = 4000;
  const reduction = pressLevel * 20;
  return Math.max(2000, baseTime - reduction);
};

export const calculateBreakProbability = (uniformity: number, dryness: number): number => {
  const uniformityFactor = (100 - uniformity) * 0.3;
  const drynessFactor = dryness > 90 ? (dryness - 90) * 2 : 0;
  return Math.min(30, uniformityFactor + drynessFactor);
};

export const calculateQualityScore = (
  concentration: number,
  uniformity: number,
  dryness: number,
  pressLevel: number,
  inspectionPoints: number
): { score: number; grade: QualityGrade } => {
  const concentrationScore = 100 - Math.abs(concentration - 50) * 1.2;
  const uniformityScore = uniformity;
  const drynessScore = dryness >= 95 ? 100 : dryness * 1.05;
  const pressScore = pressLevel >= 70 && pressLevel <= 90 ? 100 : 100 - Math.abs(pressLevel - 80) * 1.5;
  const inspectionBonus = inspectionPoints * 2;

  const totalScore = (
    concentrationScore * 0.25 +
    uniformityScore * 0.3 +
    drynessScore * 0.2 +
    pressScore * 0.15 +
    inspectionBonus
  );

  const finalScore = Math.max(0, Math.min(100, Math.round(totalScore)));

  let grade: QualityGrade;
  if (finalScore >= 90) {
    grade = 'excellent';
  } else if (finalScore >= 70) {
    grade = 'good';
  } else if (finalScore >= 50) {
    grade = 'medium';
  } else {
    grade = 'poor';
  }

  return { score: finalScore, grade };
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

export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const calculateConcentration = (materials: PulpState['materials']): number => {
  const total = materials.chuPi + materials.sangPi + materials.maXianWei;
  return clamp(total, 0, 100);
};

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
