export type Category = 'ceramic' | 'woodwork' | 'weaving' | 'leather' | 'paper';

export interface WorkStep {
  id: string;
  order: number;
  image: string;
  description: string;
  duration: number;
}

export interface Comment {
  id: string;
  workId: string;
  author: string;
  avatarColor: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface Work {
  id: string;
  name: string;
  category: Category;
  coverImage: string;
  steps: WorkStep[];
  createdAt: string;
  favorites: number;
  comments: Comment[];
}

export const categoryConfig: Record<Category, { name: string; color: string }> = {
  ceramic: { name: '陶艺', color: '#D2B48C' },
  woodwork: { name: '木工', color: '#DEB887' },
  weaving: { name: '编织', color: '#8FBC8F' },
  leather: { name: '皮艺', color: '#8B4513' },
  paper: { name: '纸艺', color: '#F5F5DC' },
};
