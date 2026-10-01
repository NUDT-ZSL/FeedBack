export type EventCategory = 'work' | 'study' | 'travel' | 'personal';

export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  category: EventCategory;
  branchId?: string;
  parentId?: string;
  createdAt: number;
  isNew?: boolean;
  isDeleting?: boolean;
}

export interface TimelineBranch {
  id: string;
  name: string;
  parentEventId: string;
}

export interface ViewportState {
  centerDate: Date;
  monthsVisible: number;
  zoom: number;
  panX: number;
}

export const CATEGORY_COLORS: Record<EventCategory, string> = {
  work: '#ff6b6b',
  study: '#4ecdc4',
  travel: '#45b7d1',
  personal: '#96ceb4',
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  work: '工作',
  study: '学习',
  travel: '旅行',
  personal: '个人',
};
