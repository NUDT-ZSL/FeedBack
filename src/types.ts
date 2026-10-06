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

export interface CardGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  /** 成员卡片 id，数组顺序即成员顺序，随状态持久化 */
  memberIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** 折叠后的容器尺寸（展开时成员恢复原位置与大小） */
  collapsedWidth: number;
  collapsedHeight: number;
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

export interface CanvasState {
  version: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  cards: Card[];
  connections: Connection[];
  /** v2 新增；旧版本（v1）状态无此字段，加载时按空数组兼容 */
  groups: CardGroup[];
}

/** 卡组相关操作的可观察结果，用于 UI 提示与批量验证断言 */
export type GroupEventType =
  | 'group-created'
  | 'group-deleted'
  | 'group-renamed'
  | 'group-collapse-changed'
  | 'member-added'
  | 'member-removed'
  | 'members-reordered'
  | 'membership-conflict'
  | 'connection-endpoint-detached';

export interface GroupEvent {
  type: GroupEventType;
  groupId?: string;
  cardId?: string;
  connectionId?: string;
  message: string;
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

export const GROUP_COLORS = [
  '#4d96ff',
  '#6bcb77',
  '#ffd93d',
  '#ff6b6b',
  '#9b59b6',
  '#1abc9c',
];

export const GRID_SIZE = 50;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;
export const DEFAULT_CARD_WIDTH = 200;
export const DEFAULT_CARD_HEIGHT = 150;
export const MIN_CARD_WIDTH = 160;
export const MIN_CARD_HEIGHT = 120;
export const TITLE_MAX_LENGTH = 30;
export const CONTENT_MAX_LENGTH = 200;
export const LABEL_MAX_LENGTH = 10;
export const GROUP_NAME_MAX_LENGTH = 20;
export const GROUP_PADDING = 16;
export const GROUP_HEADER_HEIGHT = 32;
export const COLLAPSED_GROUP_WIDTH = 220;
export const COLLAPSED_GROUP_HEIGHT = 64;
