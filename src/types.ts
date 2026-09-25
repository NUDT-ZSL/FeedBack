export type RecordType = 'income' | 'expense';

export type Category = 
  | '餐饮' 
  | '交通' 
  | '娱乐' 
  | '购物' 
  | '住房' 
  | '医疗' 
  | '教育' 
  | '工资' 
  | '奖金' 
  | '投资' 
  | '其他';

export interface Record {
  id: string;
  type: RecordType;
  amount: number;
  category: Category;
  date: string;
  note?: string;
}

export const CATEGORIES: { name: Category; type: RecordType; color: string }[] = [
  { name: '餐饮', type: 'expense', color: '#FF8C42' },
  { name: '交通', type: 'expense', color: '#4A90D9' },
  { name: '娱乐', type: 'expense', color: '#9B59B6' },
  { name: '购物', type: 'expense', color: '#E74C3C' },
  { name: '住房', type: 'expense', color: '#34495E' },
  { name: '医疗', type: 'expense', color: '#27AE60' },
  { name: '教育', type: 'expense', color: '#F39C12' },
  { name: '工资', type: 'income', color: '#2ECC71' },
  { name: '奖金', type: 'income', color: '#1ABC9C' },
  { name: '投资', type: 'income', color: '#3498DB' },
  { name: '其他', type: 'expense', color: '#95A5A6' },
];

export const getCategoryColor = (category: Category): string => {
  const found = CATEGORIES.find(c => c.name === category);
  return found ? found.color : '#95A5A6';
};

export type StorageType = 'localStorage' | 'indexedDB';

export interface StorageAdapter {
  getAll: () => Promise<Record[]>;
  add: (record: Record) => Promise<void>;
  update: (record: Record) => Promise<void>;
  delete: (id: string) => Promise<void>;
}
