import type { Question } from '../../../shared/types';

export const questions: Question[] = [
  {
    id: 'pref-1',
    text: '周末更倾向什么活动？',
    type: 'preference',
    options: ['宅家追剧', '户外运动', '朋友聚会', '独自阅读'],
    correctAnswer: -1,
    icon: 'Calendar',
  },
  {
    id: 'pref-2',
    text: '更喜欢哪种类型的电影？',
    type: 'preference',
    options: ['科幻/动作', '爱情/文艺', '喜剧/综艺', '悬疑/恐怖'],
    correctAnswer: -1,
    icon: 'Film',
  },
  {
    id: 'pref-3',
    text: '旅行时更喜欢？',
    type: 'preference',
    options: ['规划详尽的跟团游', '自由行随心逛', '户外探险', '美食探店'],
    correctAnswer: -1,
    icon: 'Plane',
  },
  {
    id: 'pref-4',
    text: '你更喜欢哪种饮食口味？',
    type: 'preference',
    options: ['清淡养生', '麻辣鲜香', '酸甜可口', '原味自然'],
    correctAnswer: -1,
    icon: 'UtensilsCrossed',
  },
  {
    id: 'opinion-1',
    text: '对AI取代工作的看法？',
    type: 'opinion',
    options: ['乐观，会创造新机会', '担忧，会造成失业潮', '中性，技术发展必然', '不确定，走一步看一步'],
    correctAnswer: -1,
    icon: 'Brain',
  },
  {
    id: 'opinion-2',
    text: '是否支持异地恋？',
    type: 'opinion',
    options: ['支持，真爱不受距离限制', '不支持，陪伴很重要', '看具体情况', '没经历过，不好说'],
    correctAnswer: -1,
    icon: 'Heart',
  },
  {
    id: 'opinion-3',
    text: '工作和生活能分开吗？',
    type: 'opinion',
    options: ['完全可以', '做不到，总会混在一起', '尽量分开', '没想过这个问题'],
    correctAnswer: -1,
    icon: 'Briefcase',
  },
  {
    id: 'fact-1',
    text: '哪个国家面积最大？',
    type: 'fact',
    options: ['中国', '美国', '俄罗斯', '加拿大'],
    correctAnswer: 2,
    icon: 'Globe',
  },
  {
    id: 'fact-2',
    text: '水的化学式是？',
    type: 'fact',
    options: ['H2O2', 'H2O', 'CO2', 'O2'],
    correctAnswer: 1,
    icon: 'Droplets',
  },
  {
    id: 'fact-3',
    text: '光速大约是多少？',
    type: 'fact',
    options: ['30万公里/秒', '15万公里/秒', '50万公里/秒', '10万公里/秒'],
    correctAnswer: 0,
    icon: 'Zap',
  },
];

export const preferenceQuestions = questions.filter(q => q.type === 'preference');
export const opinionQuestions = questions.filter(q => q.type === 'opinion');
export const factQuestions = questions.filter(q => q.type === 'fact');
