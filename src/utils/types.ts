export type IdeaStatus = 'draft' | 'in-progress' | 'completed';

export type TagLogic = 'and' | 'or';

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Idea {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  tags: string[];
  priority: number;
  status: IdeaStatus;
  columnId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KanbanColumn {
  id: string;
  name: string;
  order: number;
}

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  draft: '草稿',
  'in-progress': '进行中',
  completed: '已完成',
};

export const STATUS_COLORS: Record<IdeaStatus, string> = {
  draft: '#6b7280',
  'in-progress': '#3b82f6',
  completed: '#10b981',
};

export const TAG_COLORS = [
  '#e94560',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#14b8a6',
  '#6366f1',
];
