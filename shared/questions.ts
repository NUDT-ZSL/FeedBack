import { Question } from './types';

const preferenceQuestions: Omit<Question, 'id' | 'type' | 'correctAnswer'>[] = [
  { text: '周末更倾向什么活动？', options: ['宅家追剧', '户外运动', '朋友聚会', '独自阅读'], icon: 'calendar' },
  { text: '更喜欢哪种类型的电影？', options: ['科幻/动作', '爱情/文艺', '喜剧/综艺', '悬疑/恐怖'], icon: 'film' },
  { text: '旅行时更喜欢？', options: ['规划详尽的跟团游', '自由行随心逛', '户外探险', '美食探店'], icon: 'plane' },
];

const opinionQuestions: Omit<Question, 'id' | 'type' | 'correctAnswer'>[] = [
  { text: '对AI取代工作的看法？', options: ['乐观，会创造新机会', '担忧，会造成失业潮', '中性，技术发展必然', '不确定，走一步看一步'], icon: 'brain' },
  { text: '是否支持异地恋？', options: ['支持，真爱不受距离限制', '不支持，陪伴很重要', '看具体情况', '没经历过，不好说'], icon: 'heart' },
  { text: '工作和生活能分开吗？', options: ['完全可以', '做不到，总会混在一起', '尽量分开', '没想过这个问题'], icon: 'briefcase' },
];

const factQuestions: Omit<Question, 'id' | 'type'>[] = [
  { text: '哪个国家面积最大？', options: ['中国', '美国', '俄罗斯', '加拿大'], correctAnswer: 2, icon: 'globe' },
  { text: '水的化学式是？', options: ['H2O2', 'H2O', 'CO2', 'O2'], correctAnswer: 1, icon: 'droplets' },
  { text: '光速大约是多少？', options: ['30万公里/秒', '15万公里/秒', '50万公里/秒', '10万公里/秒'], correctAnswer: 0, icon: 'zap' },
  { text: '世界上最长的河流是？', options: ['亚马逊河', '长江', '尼罗河', '密西西比河'], correctAnswer: 2, icon: 'waves' },
];

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export const allQuestions: Question[] = [
  ...preferenceQuestions.map(q => ({ ...q, id: generateId(), type: 'preference' as const, correctAnswer: -1 })),
  ...opinionQuestions.map(q => ({ ...q, id: generateId(), type: 'opinion' as const, correctAnswer: -1 })),
  ...factQuestions.map(q => ({ ...q, id: generateId(), type: 'fact' as const })),
];

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function selectRandomQuestions(count: number = 10): Question[] {
  return shuffleArray(allQuestions).slice(0, count);
}
