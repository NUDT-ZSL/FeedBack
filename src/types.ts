export interface Planet {
  id: number;
  position: [number, number, number];
  color: string;
  ringType: 'ecliptic' | 'equator' | 'galactic';
  prediction: string;
  timestamp: number;
}

export interface StarRecord {
  id: string;
  thumbnail: string;
  timestamp: number;
  predictions: string[];
  planets: Planet[];
  starAngles: {
    ecliptic: number;
    equator: number;
    galactic: number;
  };
}

export interface StarAngles {
  ecliptic: number;
  equator: number;
  galactic: number;
}

export const RING_COLORS = {
  ecliptic: '#ffd700',
  equator: '#00bfff',
  galactic: '#ff4444'
} as const;

export const PREDICTIONS = [
  '紫气东来',
  '荧惑守心',
  '七星连珠',
  '月晕而风',
  '北斗指路',
  '玄武当空'
] as const;

export const ZODIAC_SIGNS = [
  { name: '白羊', symbol: '♈', interpretation: '阳气初生，万物复苏，宜开拓进取' },
  { name: '金牛', symbol: '♉', interpretation: '土德厚载，财富积聚，宜守正持重' },
  { name: '双子', symbol: '♊', interpretation: '双灵并起，消息流转，宜顺势变通' },
  { name: '巨蟹', symbol: '♋', interpretation: '月归巨蟹，内藏守势，宜固本安宅' },
  { name: '狮子', symbol: '♌', interpretation: '烈日当空，威加四海，宜展才立威' },
  { name: '处女', symbol: '♍', interpretation: '秋毫可察，精研细理，宜整饬纲纪' },
  { name: '天秤', symbol: '♎', interpretation: '权衡两端，中道而行，宜调停决断' },
  { name: '天蝎', symbol: '♏', interpretation: '荧惑入渊，机锋暗藏，宜静守待时' },
  { name: '射手', symbol: '♐', interpretation: '矢指北辰，志在远方，宜出师远征' },
  { name: '摩羯', symbol: '♑', interpretation: '土行渐升，厚积薄发，宜坚忍图成' },
  { name: '水瓶', symbol: '♒', interpretation: '玄水倾天，革故鼎新，宜变法开新' },
  { name: '双鱼', symbol: '♓', interpretation: '星河归海，万象朦胧，宜静心观妙' }
] as const;
