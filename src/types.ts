export type ComponentType = 'image' | 'text' | 'divider' | 'banner';

export interface BaseComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  shadow: boolean;
  opacity: number;
}

export interface ImageComponent extends BaseComponent {
  type: 'image';
  imageUrl: string;
  title: string;
  year: string;
  description: string;
}

export interface TextComponent extends BaseComponent {
  type: 'text';
  content: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
}

export interface DividerComponent extends BaseComponent {
  type: 'divider';
  color: string;
  thickness: number;
}

export interface BannerComponent extends BaseComponent {
  type: 'banner';
  text: string;
  fontSize: number;
  textColor: string;
}

export type ExhibitionComponent = ImageComponent | TextComponent | DividerComponent | BannerComponent;

export interface ThemeColor {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
}

export interface Exhibition {
  id: string;
  name: string;
  themeColor: ThemeColor;
  description: string;
  components: ExhibitionComponent[];
  thumbnail: string | null;
  createdAt: string;
  published: boolean;
}

export const THEME_COLORS: ThemeColor[] = [
  { id: 'impressionist', name: '印象派暖色', primary: '#d4a574', secondary: '#c9865c', accent: '#8b6914', background: '#faf3e8' },
  { id: 'minimal', name: '极简黑白', primary: '#2c2c2c', secondary: '#5a5a5a', accent: '#000000', background: '#ffffff' },
  { id: 'cyberpunk', name: '赛博朋克霓虹', primary: '#ff00ff', secondary: '#00ffff', accent: '#ffcc00', background: '#0a0a1a' },
  { id: 'ocean', name: '海洋蓝调', primary: '#1e6091', secondary: '#2a7ab8', accent: '#4db8c9', background: '#e8f4f8' },
  { id: 'forest', name: '森林绿意', primary: '#2d5a27', secondary: '#4a8b3c', accent: '#8bc34a', background: '#e8f5e9' },
  { id: 'sunset', name: '落日余晖', primary: '#e85d4a', secondary: '#f29e3d', accent: '#f7d046', background: '#fff4e8' },
  { id: 'vintage', name: '复古怀旧', primary: '#8b7355', secondary: '#a0826d', accent: '#c9b896', background: '#f5efe6' },
  { id: 'sakura', name: '樱花粉调', primary: '#f8bbd0', secondary: '#f48fb1', accent: '#ec407a', background: '#fff0f5' }
];
