export interface StarData {
  id: string;
  name: string;
  latinName: string;
  color: string;
  size: number;
  ra: number;
  dec: number;
  magnitude: number;
  description: string;
  type: 'star' | 'planet' | 'moon';
}

export interface ScalePosition {
  ra: number;
  dec: number;
}

export interface ObservationRecord {
  id: string;
  timestamp: Date;
  time: string;
  starName: string;
  starColor: string;
  ra: number;
  dec: number;
  hour: number;
}

export interface CelestialBody {
  position: [number, number, number];
  color: string;
  size: number;
  name: string;
  latinName: string;
  magnitude: number;
  description: string;
  type: 'star' | 'planet' | 'moon';
}

export interface PlanetData {
  name: string;
  latinName: string;
  color: string;
  size: number;
  orbitRadius: number;
  orbitSpeed: number;
  magnitude: number;
  description: string;
}

export const PLANET_DATA: PlanetData[] = [
  { name: '水星', latinName: 'Mercury', color: '#e0e0e0', size: 0.1, orbitRadius: 8, orbitSpeed: 4.15, magnitude: 0.0, description: '距离太阳最近的行星' },
  { name: '金星', latinName: 'Venus', color: '#fff4cc', size: 0.15, orbitRadius: 12, orbitSpeed: 1.62, magnitude: -4.0, description: '最亮的行星，又称太白金星' },
  { name: '火星', latinName: 'Mars', color: '#cc3333', size: 0.12, orbitRadius: 18, orbitSpeed: 0.53, magnitude: 2.0, description: '红色行星，古称荧惑' },
  { name: '木星', latinName: 'Jupiter', color: '#cc8844', size: 0.2, orbitRadius: 25, orbitSpeed: 0.084, magnitude: -2.5, description: '最大的行星，古称岁星' },
  { name: '土星', latinName: 'Saturn', color: '#ffdd66', size: 0.18, orbitRadius: 32, orbitSpeed: 0.034, magnitude: 0.5, description: '带光环的行星，古称镇星' },
];

export const STAR_NAMES = [
  { name: '北极星', latin: 'α Ursae Minoris', desc: '紫微星，帝星，天之枢纽' },
  { name: '天枢', latin: 'α Ursae Majoris', desc: '北斗七星之首' },
  { name: '天璇', latin: 'β Ursae Majoris', desc: '北斗七星之二' },
  { name: '天玑', latin: 'γ Ursae Majoris', desc: '北斗七星之三' },
  { name: '天权', latin: 'δ Ursae Majoris', desc: '北斗七星之四' },
  { name: '玉衡', latin: 'ε Ursae Majoris', desc: '北斗七星之五' },
  { name: '开阳', latin: 'ζ Ursae Majoris', desc: '北斗七星之六' },
  { name: '摇光', latin: 'η Ursae Majoris', desc: '北斗七星之七' },
  { name: '织女星', latin: 'α Lyrae', desc: '天琴座主星，七夕传说' },
  { name: '牛郎星', latin: 'α Aquilae', desc: '天鹰座主星，河鼓二' },
  { name: '天津四', latin: 'α Cygni', desc: '天鹅座主星，夏季大三角' },
  { name: '参宿四', latin: 'α Orionis', desc: '猎户座红超巨星' },
  { name: '参宿七', latin: 'β Orionis', desc: '猎户座蓝超巨星' },
  { name: '天狼星', latin: 'α Canis Majoris', desc: '夜空中最亮的恒星' },
  { name: '南河三', latin: 'α Canis Minoris', desc: '小犬座主星' },
  { name: '北河三', latin: 'β Geminorum', desc: '双子座最亮星' },
  { name: '五车二', latin: 'α Aurigae', desc: '御夫座主星' },
  { name: '角宿一', latin: 'α Virginis', desc: '室女座主星' },
  { name: '心宿二', latin: 'α Scorpii', desc: '天蝎座主星，又称大火' },
  { name: '毕宿五', latin: 'α Tauri', desc: '金牛座主星，赤帝之子' },
];

export const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

export const SHICHEN_HOURS = [23, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21];
