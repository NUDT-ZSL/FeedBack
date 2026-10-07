export interface Card {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export type ConnectionType = 'arrow' | 'dashed';

export interface Connection {
  id: string;
  fromCardId: string;
  toCardId: string;
  type: ConnectionType;
  color: string;
  label: string;
}

export interface CardGroup {
  id: string;
  name: string;
  collapsed: boolean;
  /** 折叠时摘要容器在画布上的位置（展开时忽略，由成员包围盒决定） */
  x: number;
  y: number;
  /** 成员卡片 id，数组顺序即成员顺序，随画布状态持久化 */
  memberIds: string[];
  color: string;
}

export interface CanvasState {
  version: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  cards: Card[];
  connections: Connection[];
  groups: CardGroup[];
  /** 大纲面板中手动重排后的卡片顺序（cardId 列表），可选以兼容旧数据 */
  outlineOrder?: string[];
}

export interface OutlineStep {
  cardId: string;
  order: number;
}

export type ToolMode = 'select' | 'boxSelect' | 'connect';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 连线端点吸附目标：卡片本体或折叠后的卡组容器 */
export type AnchorTarget =
  | { kind: 'card'; id: string }
  | { kind: 'group'; id: string };

/** 单条连线在当前画布状态下的可观察解析结果 */
export interface ResolvedConnection {
  connection: Connection;
  hidden: boolean;
  hiddenReason?: 'same-collapsed-group' | 'dangling-endpoint';
  from: AnchorTarget | null;
  to: AnchorTarget | null;
}

export const CANVAS_STORAGE_VERSION = 2;
export const STORAGE_KEY = 'inspiration-board-state';

export const CARD_COLORS = [
  '#2a2a4e',
  '#ff6b6b',
  '#ffd93d',
  '#6bcb77',
  '#4d96ff',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#34495e',
  '#e91e63',
  '#00bcd4',
  '#795548',
];

export const CONNECTION_COLORS = [
  '#aaaaaa',
  '#ff6b6b',
  '#ffd93d',
  '#6bcb77',
  '#4d96ff',
  '#9b59b6',
];

export const GRID_SIZE = 50;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;
export const DEFAULT_CARD_WIDTH = 200;
export const DEFAULT_CARD_HEIGHT = 150;
export const MIN_CARD_WIDTH = 160;
export const MIN_CARD_HEIGHT = 120;
export const GROUP_CHIP_WIDTH = 240;
export const GROUP_CHIP_HEIGHT = 96;
export const GROUP_PADDING = 24;
export const GROUP_HEADER_HEIGHT = 28;
export const TITLE_MAX_LENGTH = 30;
export const CONTENT_MAX_LENGTH = 200;
export const LABEL_MAX_LENGTH = 10;
export const GROUP_NAME_MAX_LENGTH = 20;

export const GROUP_COLORS = [
  '#4d96ff',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#e91e63',
  '#6bcb77',
];
