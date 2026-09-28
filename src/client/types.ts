export interface BandTheme {
  id: string;
  name: string;
  genre: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  background: {
    type: 'gradient' | 'pattern';
    gradient?: { from: string; to: string; angle: number };
    pattern?: string;
  };
  emoji: string;
}

export interface ElementConfig {
  id: string;
  type: 'title' | 'date' | 'venue' | 'price' | 'custom';
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  zIndex: number;
}

export interface PosterConfig {
  bandId: string;
  elements: ElementConfig[];
  customCss: string;
}

export interface ShareResponse {
  success: boolean;
  id?: string;
  url?: string;
  error?: string;
}

export interface LoadResponse {
  success: boolean;
  data?: PosterConfig;
  error?: string;
}

export const BAND_THEMES: BandTheme[] = [
  {
    id: 'jazz-night',
    name: '午夜爵士三重奏',
    genre: 'JAZZ',
    primaryColor: '#d4a853',
    secondaryColor: '#2d1f0f',
    accentColor: '#f5deb3',
    background: {
      type: 'gradient',
      gradient: { from: '#1a0f0a', to: '#3d2817', angle: 135 },
    },
    emoji: '🎷',
  },
  {
    id: 'thunder-strike',
    name: '雷霆重击',
    genre: 'HEAVY METAL',
    primaryColor: '#ff2d2d',
    secondaryColor: '#0a0a0a',
    accentColor: '#ffffff',
    background: {
      type: 'gradient',
      gradient: { from: '#0a0a0a', to: '#3a0a0a', angle: 160 },
    },
    emoji: '🎸',
  },
  {
    id: 'neon-pulse',
    name: '霓虹脉冲',
    genre: 'ELECTRONIC',
    primaryColor: '#00d4ff',
    secondaryColor: '#ff006e',
    accentColor: '#be0aff',
    background: {
      type: 'gradient',
      gradient: { from: '#0f0520', to: '#1a0533', angle: 180 },
    },
    emoji: '🎹',
  },
  {
    id: 'indie-dream',
    name: '独立梦境',
    genre: 'INDIE ROCK',
    primaryColor: '#e879f9',
    secondaryColor: '#7c3aed',
    accentColor: '#fbbf24',
    background: {
      type: 'gradient',
      gradient: { from: '#1e1b4b', to: '#4c1d95', angle: 120 },
    },
    emoji: '🎤',
  },
];

export const FONT_OPTIONS = [
  { label: 'Orbitron (未来感)', value: "'Orbitron', sans-serif" },
  { label: 'Space Grotesk (现代)', value: "'Space Grotesk', sans-serif" },
  { label: 'Playfair Display (优雅)', value: "'Playfair Display', serif" },
  { label: 'Bebas Neue (粗体)', value: "'Bebas Neue', sans-serif" },
  { label: 'JetBrains Mono (等宽)', value: "'JetBrains Mono', monospace" },
];

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;
