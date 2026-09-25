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

export interface BudgetRecord {
  id: string;
  type: RecordType;
  amount: number;
  category: Category;
  date: string;
  note?: string;
}

export interface CategoryDefinition {
  name: Category;
  type: RecordType;
  color: string;
}

export type StorageType = 'localStorage' | 'indexedDB';

export interface StorageAdapter {
  getAll: () => Promise<BudgetRecord[]>;
  add: (record: BudgetRecord) => Promise<void>;
  update: (record: BudgetRecord) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

export interface MonthlyStats {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

export interface CategoryExpense {
  category: Category;
  amount: number;
  color: string;
}

export interface BudgetRecordDraft {
  type: RecordType;
  amount: number;
  category: Category;
  date: string;
  note?: string;
}
