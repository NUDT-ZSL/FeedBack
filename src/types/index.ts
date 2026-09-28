export type ElementType = 'text' | 'balloon' | 'cake' | 'star' | 'heart' | 'gift';

export interface CardElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  shadow?: {
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string;
  };
  emoji?: string;
}

export interface Template {
  id: string;
  name: string;
  style: 'cute' | 'simple' | 'vintage' | 'elegant' | 'playful' | 'romantic';
  backgroundColor: string;
  backgroundImage?: string;
  fontFamily: string;
  fontColor: string;
  elements: Omit<CardElement, 'id'>[];
}

export interface HistoryCard {
  id: string;
  thumbnail: string;
  elements: CardElement[];
  backgroundColor: string;
  templateId: string;
  savedAt: number;
}

export const FONTS = [
  { name: '默认', value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { name: '宋体', value: 'SimSun, serif' },
  { name: '楷体', value: 'KaiTi, STKaiti, serif' },
  { name: '黑体', value: 'SimHei, "Microsoft YaHei", sans-serif' },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Comic Sans', value: '"Comic Sans MS", cursive' },
];

export const COLORS = [
  '#FF6B6B', '#FF8E53', '#FFD93D', '#6BCB77', '#4D96FF',
  '#9B59B6', '#E84393', '#2C3E50', '#F39C12', '#1ABC9C',
  '#FFFFFF', '#000000', '#F5E6D3', '#E8D5E3', '#D5E8D4',
];

export const EMOJI_MAP: Record<ElementType, string> = {
  balloon: '🎈',
  cake: '🎂',
  star: '⭐',
  heart: '❤️',
  gift: '🎁',
  text: '📝',
};

export const TEMPLATES: Template[] = [
  {
    id: 'cute',
    name: '可爱风',
    style: 'cute',
    backgroundColor: '#FFE4EC',
    fontFamily: '"Comic Sans MS", cursive',
    fontColor: '#E84393',
    elements: [
      { type: 'text', x: 200, y: 60, width: 400, height: 60, rotation: 0, content: '生日快乐！', fontSize: 48, fontFamily: '"Comic Sans MS", cursive', fontColor: '#E84393', shadow: { offsetX: 2, offsetY: 2, blur: 4, color: 'rgba(255,105,180,0.5)' } },
      { type: 'balloon', x: 100, y: 150, width: 60, height: 80, rotation: -15, emoji: '🎈' },
      { type: 'balloon', x: 700, y: 120, width: 60, height: 80, rotation: 15, emoji: '🎈' },
      { type: 'cake', x: 320, y: 300, width: 160, height: 160, rotation: 0, emoji: '🎂' },
      { type: 'star', x: 200, y: 200, width: 40, height: 40, rotation: 20, emoji: '⭐' },
      { type: 'star', x: 600, y: 220, width: 40, height: 40, rotation: -20, emoji: '⭐' },
      { type: 'heart', x: 480, y: 200, width: 45, height: 45, rotation: 0, emoji: '❤️' },
    ],
  },
  {
    id: 'simple',
    name: '简约风',
    style: 'simple',
    backgroundColor: '#FFFFFF',
    fontFamily: 'Arial, sans-serif',
    fontColor: '#2C3E50',
    elements: [
      { type: 'text', x: 300, y: 80, width: 200, height: 50, rotation: 0, content: 'HAPPY BIRTHDAY', fontSize: 36, fontFamily: 'Arial, sans-serif', fontColor: '#2C3E50', shadow: { offsetX: 1, offsetY: 1, blur: 2, color: 'rgba(0,0,0,0.2)' } },
      { type: 'text', x: 280, y: 200, width: 240, height: 40, rotation: 0, content: '愿你一切顺利', fontSize: 24, fontFamily: 'Arial, sans-serif', fontColor: '#34495E' },
      { type: 'cake', x: 350, y: 340, width: 100, height: 100, rotation: 0, emoji: '🎂' },
    ],
  },
  {
    id: 'vintage',
    name: '复古风',
    style: 'vintage',
    backgroundColor: '#F5E6D3',
    fontFamily: 'Georgia, serif',
    fontColor: '#8B4513',
    elements: [
      { type: 'text', x: 200, y: 100, width: 400, height: 55, rotation: 0, content: '恭贺华诞', fontSize: 44, fontFamily: 'Georgia, serif', fontColor: '#8B4513', shadow: { offsetX: 3, offsetY: 3, blur: 6, color: 'rgba(139,69,19,0.3)' } },
      { type: 'text', x: 250, y: 240, width: 300, height: 35, rotation: 0, content: '岁月静好 顺遂无忧', fontSize: 22, fontFamily: 'Georgia, serif', fontColor: '#A0522D' },
      { type: 'gift', x: 180, y: 380, width: 80, height: 80, rotation: -10, emoji: '🎁' },
      { type: 'gift', x: 540, y: 380, width: 80, height: 80, rotation: 10, emoji: '🎁' },
      { type: 'star', x: 100, y: 150, width: 30, height: 30, rotation: 0, emoji: '✨' },
      { type: 'star', x: 680, y: 150, width: 30, height: 30, rotation: 0, emoji: '✨' },
    ],
  },
  {
    id: 'elegant',
    name: '优雅风',
    style: 'elegant',
    backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    fontFamily: 'Georgia, serif',
    fontColor: '#FFFFFF',
    elements: [
      { type: 'text', x: 180, y: 120, width: 440, height: 60, rotation: 0, content: 'Happy Birthday', fontSize: 52, fontFamily: 'Georgia, serif', fontColor: '#FFFFFF', shadow: { offsetX: 4, offsetY: 4, blur: 12, color: 'rgba(0,0,0,0.4)' } },
      { type: 'text', x: 300, y: 260, width: 200, height: 35, rotation: 0, content: '致最特别的你', fontSize: 24, fontFamily: 'Georgia, serif', fontColor: '#F0E6FF' },
      { type: 'heart', x: 370, y: 380, width: 60, height: 60, rotation: 0, emoji: '💜' },
    ],
  },
  {
    id: 'playful',
    name: '活泼风',
    style: 'playful',
    backgroundColor: 'linear-gradient(135deg, #FFD93D 0%, #FF6B6B 100%)',
    fontFamily: '"Comic Sans MS", cursive',
    fontColor: '#FFFFFF',
    elements: [
      { type: 'text', x: 180, y: 60, width: 440, height: 70, rotation: -5, content: '🎉 生日快乐 🎉', fontSize: 54, fontFamily: '"Comic Sans MS", cursive', fontColor: '#FFFFFF', shadow: { offsetX: 5, offsetY: 5, blur: 10, color: 'rgba(0,0,0,0.3)' } },
      { type: 'balloon', x: 60, y: 200, width: 70, height: 90, rotation: -20, emoji: '🎈' },
      { type: 'balloon', x: 130, y: 250, width: 60, height: 80, rotation: 10, emoji: '🎈' },
      { type: 'balloon', x: 620, y: 180, width: 70, height: 90, rotation: 20, emoji: '🎈' },
      { type: 'balloon', x: 700, y: 240, width: 60, height: 80, rotation: -10, emoji: '🎈' },
      { type: 'cake', x: 320, y: 280, width: 160, height: 160, rotation: 0, emoji: '🎂' },
      { type: 'gift', x: 180, y: 420, width: 70, height: 70, rotation: -15, emoji: '🎁' },
      { type: 'gift', x: 560, y: 420, width: 70, height: 70, rotation: 15, emoji: '🎁' },
    ],
  },
  {
    id: 'romantic',
    name: '浪漫风',
    style: 'romantic',
    backgroundColor: 'linear-gradient(135deg, #FFE4EC 0%, #FFDEE9 50%, #B5FFFC 100%)',
    fontFamily: 'Georgia, serif',
    fontColor: '#E84393',
    elements: [
      { type: 'text', x: 200, y: 80, width: 400, height: 60, rotation: 0, content: '💕 生日快乐 💕', fontSize: 48, fontFamily: 'Georgia, serif', fontColor: '#E84393', shadow: { offsetX: 2, offsetY: 2, blur: 8, color: 'rgba(232,67,147,0.4)' } },
      { type: 'heart', x: 150, y: 180, width: 50, height: 50, rotation: -15, emoji: '💕' },
      { type: 'heart', x: 220, y: 230, width: 40, height: 40, rotation: 10, emoji: '💗' },
      { type: 'heart', x: 540, y: 180, width: 50, height: 50, rotation: 15, emoji: '💕' },
      { type: 'heart', x: 610, y: 230, width: 40, height: 40, rotation: -10, emoji: '💗' },
      { type: 'cake', x: 340, y: 300, width: 120, height: 120, rotation: 0, emoji: '🎂' },
      { type: 'text', x: 300, y: 460, width: 200, height: 30, rotation: 0, content: '爱你的每一天', fontSize: 20, fontFamily: 'Georgia, serif', fontColor: '#D63384' },
    ],
  },
];
