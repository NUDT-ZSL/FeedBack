import { Achievement } from '../../src/types';

const defaultAchievements: Achievement[] = [
  { id: 'chain5', name: '五连消除', description: '首次消除5连', icon: '🏅', unlocked: false, progress: 0, maxProgress: 1 },
  { id: 'eliminate100', name: '百符斩', description: '累积消除100个符文', icon: '🍿', unlocked: false, progress: 0, maxProgress: 100 },
  { id: 'allClear', name: '全关通关', description: '通关所有关卡', icon: '👑', unlocked: false, progress: 0, maxProgress: 10 },
  { id: 'chain3', name: '三连连锁', description: '达成3层连锁', icon: '⚡', unlocked: false, progress: 0, maxProgress: 1 },
  { id: 'manaFull', name: '法力全满', description: '法力值达到100', icon: '💎', unlocked: false, progress: 0, maxProgress: 1 },
];

export const scoresStore: Map<string, { playerName: string; score: number; levelId: number }[]> = new Map();

export const achievementsStore: Map<string, Achievement[]> = new Map();

export function getDefaultAchievements(): Achievement[] {
  return defaultAchievements.map(a => ({ ...a }));
}
