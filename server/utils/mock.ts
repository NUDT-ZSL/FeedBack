import type { MoodType, MoodRecord, MoodConfig } from '../types';

export const MOOD_CONFIGS: MoodConfig[] = [
  { type: 'happy', label: '快乐', emoji: '😊', color: '#FFD700' },
  { type: 'calm', label: '平静', emoji: '😌', color: '#98FB98' },
  { type: 'anxious', label: '焦虑', emoji: '😰', color: '#FF6347' },
  { type: 'tired', label: '疲惫', emoji: '😴', color: '#DDA0DD' },
  { type: 'angry', label: '生气', emoji: '😠', color: '#DC143C' },
];

export const MOTIVATIONAL_QUOTES: string[] = [
  '每一天都是新的开始，保持微笑，迎接美好！',
  '团队的力量是无穷的，我们一起加油！',
  '困难只是暂时的，相信自己，你一定可以！',
  '工作虽然辛苦，但你的每一份付出都有价值！',
  '保持积极的心态，生活会给你惊喜！',
];

const MOOD_TYPES: MoodType[] = ['happy', 'calm', 'anxious', 'tired', 'angry'];

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function generateMockData(days: number): MoodRecord[] {
  const records: MoodRecord[] = [];
  const now = new Date();

  for (let day = 0; day < days; day++) {
    const date = new Date(now);
    date.setDate(date.getDate() - day);
    const dateStr = formatDate(date);

    const count = Math.floor(Math.random() * 11) + 10;

    for (let i = 0; i < count; i++) {
      const hour = Math.floor(Math.random() * 12) + 8;
      const minute = Math.floor(Math.random() * 60);
      const recordDate = new Date(date);
      recordDate.setHours(hour, minute, 0, 0);

      const mood = MOOD_TYPES[Math.floor(Math.random() * MOOD_TYPES.length)];

      records.push({
        id: generateId(),
        mood,
        timestamp: recordDate.getTime(),
        date: dateStr,
      });
    }
  }

  return records.sort((a, b) => b.timestamp - a.timestamp);
}
