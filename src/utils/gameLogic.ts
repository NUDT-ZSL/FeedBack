export type PitchResult = 'hit' | 'ear' | 'miss';

export interface PitchOutcome {
  result: PitchResult;
  score: number;
  label: string;
}

export const TOTAL_PITCHES = 8;

export function determinePitchResult(x: number, y: number): PitchOutcome {
  const potCenterX = 40;
  const potCenterY = 20;
  const potMouthRadiusX = 30;
  const potMouthRadiusY = 20;
  const earCenterY = 60;
  const earRadius = 10;
  
  const normalizedX = x - potCenterX;
  const normalizedY = y - potCenterY;
  
  const mouthValue = 
    (normalizedX * normalizedX) / (potMouthRadiusX * potMouthRadiusX) +
    (normalizedY * normalizedY) / (potMouthRadiusY * potMouthRadiusY);
  
  if (mouthValue <= 0.8) {
    return { result: 'hit', score: 10, label: '投中' };
  }
  
  const leftEarDist = Math.sqrt(
    Math.pow(x - (-12), 2) + Math.pow(y - earCenterY, 2)
  );
  const rightEarDist = Math.sqrt(
    Math.pow(x - 92, 2) + Math.pow(y - earCenterY, 2)
  );
  
  if (leftEarDist <= earRadius || rightEarDist <= earRadius) {
    return { result: 'ear', score: 5, label: '卡耳' };
  }
  
  if (mouthValue <= 1.3) {
    return { result: 'miss', score: 0, label: '擦边' };
  }
  
  return { result: 'miss', score: 0, label: '落空' };
}

export function calculateTitle(totalScore: number): { title: string; color: string } {
  if (totalScore >= 80) {
    return { title: '投壶圣手', color: '#ffd700' };
  } else if (totalScore >= 50) {
    return { title: '宴席高手', color: '#d4a017' };
  } else {
    return { title: '还需练练', color: '#c0392b' };
  }
}
