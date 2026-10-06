export type EventCategory = 'work' | 'study' | 'travel' | 'personal';

export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  category: EventCategory;
  branchId?: string;
  parentId?: string;
  /**
   * 分支事件相对主事件的偏移天数。
   * 为 number 时处于“偏移模式”，日期由主事件日期 + offsetDays 推导；
   * 为 null/undefined 时处于“手动模式”，使用自身 date，不随主事件重排。
   */
  offsetDays?: number | null;
  createdAt: number;
  isNew?: boolean;
  isDeleting?: boolean;
}

export interface TimelineBranch {
  id: string;
  name: string;
  parentEventId: string;
}

/**
 * 分支事件之间的先后依赖（有向约束）：
 * toId 必须晚于 fromId（至少晚 1 天）。
 */
export interface EventDependency {
  id: string;
  fromId: string;
  toId: string;
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
