import { v4 as uuidv4 } from 'uuid';
import {
  BudgetRecord,
  BudgetRecordDraft,
  CategoryDefinition,
  CategoryExpense,
  MonthlyStats,
  RecordType,
} from '../types';

export const CATEGORIES: CategoryDefinition[] = [
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

export const DEFAULT_EXPENSE_CATEGORY = CATEGORIES[0].name;
export const DEFAULT_INCOME_CATEGORY = CATEGORIES[7].name;

export const getCategoryColor = (category: BudgetRecord['category']): string =>
  CATEGORIES.find(item => item.name === category)?.color ?? '#95A5A6';

export const getCategoriesByType = (type: RecordType): CategoryDefinition[] =>
  CATEGORIES.filter(category => category.type === type);

export const createRecord = (
  draft: BudgetRecordDraft,
  generateId: () => string = uuidv4,
): BudgetRecord => ({
  id: generateId(),
  ...draft,
  note: draft.note || undefined,
});

export const updateRecordFromDraft = (
  current: BudgetRecord,
  draft: BudgetRecordDraft,
): BudgetRecord => ({
  ...current,
  ...draft,
  note: draft.note || undefined,
});

export const getMonthlyStats = (
  records: BudgetRecord[],
  now: Date = new Date(),
): MonthlyStats => {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const monthlyRecords = records.filter(record => {
    const recordDate = new Date(record.date);
    return (
      recordDate.getFullYear() === currentYear &&
      recordDate.getMonth() === currentMonth
    );
  });

  return monthlyRecords.reduce<MonthlyStats>(
    (stats, record) => {
      if (record.type === 'income') {
        stats.totalIncome += record.amount;
      } else {
        stats.totalExpense += record.amount;
      }
      stats.balance = stats.totalIncome - stats.totalExpense;
      return stats;
    },
    { totalIncome: 0, totalExpense: 0, balance: 0 },
  );
};

export const getExpensesByCategory = (
  records: BudgetRecord[],
): CategoryExpense[] => {
  const categoryTotals = new Map<BudgetRecord['category'], number>();

  records
    .filter(record => record.type === 'expense')
    .forEach(record => {
      categoryTotals.set(
        record.category,
        (categoryTotals.get(record.category) ?? 0) + record.amount,
      );
    });

  return CATEGORIES.filter(category => category.type === 'expense')
    .map(category => ({
      category: category.name,
      amount: categoryTotals.get(category.name) ?? 0,
      color: category.color,
    }))
    .filter(item => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
};

export const filterRecords = (
  records: BudgetRecord[],
  category: string,
  date: string,
): BudgetRecord[] =>
  records.filter(record => {
    if (category !== 'all' && record.category !== category) return false;
    if (date && record.date !== date) return false;
    return true;
  });
