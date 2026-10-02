import type { UrgencyLevel, Point, PostStation, Horse, Document } from './types';

export const SPEED_MAP: Record<UrgencyLevel, number> = {
  normal: 1.0,
  urgent: 0.6,
  extreme: 0.3,
};

export const TIME_LIMIT_MAP: Record<UrgencyLevel, number> = {
  normal: 15,
  urgent: 10,
  extreme: 8,
};

export const URGENCY_COLORS: Record<UrgencyLevel, string> = {
  normal: '#22c55e',
  urgent: '#eab308',
  extreme: '#ef4444',
};

export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  normal: '普通',
  urgent: '加急',
  extreme: '八百里加急',
};

export const STATION_NAMES = [
  '京师驿站',
  '保定驿',
  '正定驿',
  '太原驿',
  '榆林驿',
  '宁夏驿',
  '嘉峪关驿',
];

export const randomInt = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const generateDocumentCode = (count: number): string => {
  const prefix = '甲乙丙丁戊己庚辛壬癸'[Math.floor(count / 10) % 10];
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = String(count % 1000).padStart(3, '0');
  return `${prefix}-${date}-${suffix}`;
};

export const generateStations = (): PostStation[] => {
  const stations: PostStation[] = [];
  const startX = 80;
  const endX = 920;
  const stepX = (endX - startX) / 6;

  for (let i = 0; i < 7; i++) {
    const x = startX + stepX * i;
    const y = 180 + Math.sin(i * 0.8) * 60;
    const documents: Document[] = [];
    
    const docCount = randomInt(1, 3);
    for (let j = 0; j < docCount; j++) {
      const urgencies: UrgencyLevel[] = ['normal', 'urgent', 'extreme'];
      const urgency = urgencies[randomInt(0, 2)];
      const toIdx = i < 6 ? randomInt(i + 1, 6) : randomInt(0, i - 1);
      
      documents.push({
        id: `doc-${i}-${j}`,
        code: generateDocumentCode(i * 10 + j),
        urgency,
        fromStation: `station-${i}`,
        toStation: `station-${toIdx}`,
        status: 'pending',
        timeLimit: TIME_LIMIT_MAP[urgency],
      });
    }

    stations.push({
      id: `station-${i}`,
      name: STATION_NAMES[i],
      position: { x, y },
      horses: randomInt(5, 15),
      soldiers: randomInt(3, 8),
      documents,
    });
  }
  return stations;
};

export const generateHorses = (): Horse[] => {
  const horseNames = ['赤兔', '的卢', '绝影', '爪黄飞电', '汗血', '追风', '飞霜'];
  return horseNames.map((name, i) => ({
    id: `horse-${i}`,
    name,
    available: true,
  }));
};

export const getEffectiveDuration = (
  urgency: UrgencyLevel,
  stamina: number,
  stations: number
): number => {
  const baseSpeed = SPEED_MAP[urgency];
  const speedMultiplier = stamina < 30 ? 1 / 0.7 : 1;
  return baseSpeed * speedMultiplier * stations;
};

export const interpolatePosition = (
  from: Point,
  to: Point,
  progress: number
): Point => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
});

export const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
};

export const getStationIndex = (stationId: string): number => {
  return parseInt(stationId.split('-')[1], 10);
};
