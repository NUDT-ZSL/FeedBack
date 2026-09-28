export type ComponentType =
  | 'button'
  | 'input'
  | 'list'
  | 'navbar'
  | 'image'
  | 'text'
  | 'card'
  | 'checkbox'
  | 'dropdown';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface UIComponent {
  id: string;
  type: ComponentType;
  position: Position;
  size: Size;
  text: string;
  backgroundColor: string;
  icon?: string;
  pageId: string;
  targetPageId?: string;
}

export interface Connection {
  id: string;
  fromComponentId: string;
  toComponentId: string;
  fromPageId: string;
  toPageId: string;
}

export interface Page {
  id: string;
  name: string;
  components: UIComponent[];
  connections: Connection[];
}

export interface Comment {
  id: string;
  componentId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  mentions: string[];
  timestamp: number;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

export const MOCK_USERS: User[] = [
  {
    id: 'user-1',
    name: '张伟',
    avatar: '张',
    color: '#1976d2',
  },
  {
    id: 'user-2',
    name: '李娜',
    avatar: '李',
    color: '#388e3c',
  },
  {
    id: 'user-3',
    name: '王芳',
    avatar: '王',
    color: '#d32f2f',
  },
];

export const PRESET_ICONS: string[] = [
  '👤',
  '🔔',
  '⚙️',
  '📷',
  '❤️',
];

export const COMPONENT_DEFAULTS: Record<ComponentType, { size: Size; text: string; icon?: string }> = {
  button: { size: { width: 160, height: 40 }, text: '按钮' },
  input: { size: { width: 200, height: 40 }, text: '请输入...' },
  list: { size: { width: 240, height: 120 }, text: '列表项 1\n列表项 2\n列表项 3' },
  navbar: { size: { width: 400, height: 50 }, text: '首页  产品  关于' },
  image: { size: { width: 200, height: 140 }, text: '', icon: '🖼️' },
  text: { size: { width: 200, height: 30 }, text: '这是一段文本内容' },
  card: { size: { width: 200, height: 160 }, text: '卡片标题\n卡片描述信息' },
  checkbox: { size: { width: 140, height: 32 }, text: '选项 A' },
  dropdown: { size: { width: 180, height: 40 }, text: '下拉选择 ▼' },
};
