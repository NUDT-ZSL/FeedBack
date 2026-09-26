import type { MoodConfig } from './types';

export const MOOD_CONFIGS: MoodConfig[] = [
  { type: 'happy', label: '快乐', emoji: '😊', color: '#FFD700' },
  { type: 'calm', label: '平静', emoji: '😌', color: '#98FB98' },
  { type: 'anxious', label: '焦虑', emoji: '😰', color: '#FF6347' },
  { type: 'tired', label: '疲惫', emoji: '😴', color: '#DDA0DD' },
  { type: 'angry', label: '生气', emoji: '😠', color: '#DC143C' },
];

export const MOTIVATIONAL_QUOTES: string[] = [
  '每一天都是新的开始，保持微笑！',
  '团队的力量来自每个人的真诚。',
  '你的心情很重要，分享让我们更紧密。',
  '今天也是充满希望的一天！',
  '真诚面对自己，才能更好地成长。',
];

export const ADMIN_PASSWORD = 'tomcat123';

export const BUBBLE_SIZE_FACTOR = 2;
