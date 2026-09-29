export type TaskCategory = 'environmental' | 'elderly' | 'education';

export interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  location: string;
  requiredCount: number;
  claimedCount: number;
  description: string;
  createdAt: number;
  isClaimed: boolean;
  feedback?: Feedback;
}

export interface Feedback {
  id: string;
  taskId: string;
  description: string;
  imageUrl?: string;
  submittedAt: number;
}

export type FilterCategory = 'all' | TaskCategory;

export const CATEGORY_COLORS: Record<TaskCategory, string> = {
  environmental: '#4CAF50',
  elderly: '#2196F3',
  education: '#FF9800'
};

export const CATEGORY_LABELS: Record<FilterCategory, string> = {
  all: '全部',
  environmental: '环保',
  elderly: '敬老',
  education: '助学'
};
