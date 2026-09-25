import React, { useMemo, useState } from 'react';
import {
  BudgetRecord,
  BudgetRecordDraft,
  Category,
  RecordType,
} from '../types';
import {
  DEFAULT_EXPENSE_CATEGORY,
  DEFAULT_INCOME_CATEGORY,
  getCategoriesByType,
} from '../domain/budget';
import { isPositiveAmount } from '../utils/errors';
import { parseAmount, toDateInputValue } from '../utils/format';

interface RecordFormProps {
  mode: 'add' | 'edit';
  initialRecord?: BudgetRecord | null;
  onSubmit: (draft: BudgetRecordDraft) => void;
  onClose: () => void;
}

type FormState = {
  type: RecordType;
  amount: string;
  category: Category;
  date: string;
  note: string;
};

const createInitialState = (
  mode: 'add' | 'edit',
  record?: BudgetRecord | null,
): FormState => {
  if (mode === 'edit' && record) {
    return {
      type: record.type,
      amount: record.amount.toString(),
      category: record.category,
      date: record.date,
      note: record.note ?? '',
    };
  }

  return {
    type: 'expense',
    amount: '',
    category: DEFAULT_EXPENSE_CATEGORY,
    date: toDateInputValue(),
    note: '',
  };
};

const RecordForm: React.FC<RecordFormProps> = ({
  mode,
  initialRecord,
  onSubmit,
  onClose,
}) => {
  const [formData, setFormData] = useState<FormState>(() =>
    createInitialState(mode, initialRecord),
  );

  const availableCategories = useMemo(
    () => getCategoriesByType(formData.type),
    [formData.type],
  );

  const changeType = (type: RecordType): void => {
    setFormData(current => ({
      ...current,
      type,
      category:
        type === 'income'
          ? DEFAULT_INCOME_CATEGORY
          : DEFAULT_EXPENSE_CATEGORY,
    }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const amount = parseAmount(formData.amount);
    if (!isPositiveAmount(amount)) {
      alert('请输入有效的金额');
      return;
    }

    onSubmit({
      type: formData.type,
      amount,
      category: formData.category,
      date: formData.date,
      note: formData.note || undefined,
    });
  };

  return (
    <div className="form-overlay" onClick={onClose}>
      <div className="form-modal" onClick={event => event.stopPropagation()}>
        <h2 className="form-title">
          {mode === 'add' ? '添加记录' : '编辑记录'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="type-toggle">
            <button
              type="button"
              className={`type-btn ${formData.type === 'income' ? 'active-income' : ''}`}
              onClick={() => changeType('income')}
            >
              收入
            </button>
            <button
              type="button"
              className={`type-btn ${formData.type === 'expense' ? 'active-expense' : ''}`}
              onClick={() => changeType('expense')}
            >
              支出
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">类别</label>
            <select
              className="form-select"
              value={formData.category}
              onChange={event =>
                setFormData({
                  ...formData,
                  category: event.target.value as Category,
                })
              }
              required
            >
              {availableCategories.map(category => (
                <option key={category.name} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">金额</label>
            <input
              type="number"
              className="form-input"
              value={formData.amount}
              onChange={event =>
                setFormData({ ...formData, amount: event.target.value })
              }
              placeholder="请输入金额"
              step="0.01"
              min="0"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">日期</label>
            <input
              type="date"
              className="form-input"
              value={formData.date}
              onChange={event =>
                setFormData({ ...formData, date: event.target.value })
              }
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">备注（可选）</label>
            <input
              type="text"
              className="form-input"
              value={formData.note}
              onChange={event =>
                setFormData({ ...formData, note: event.target.value })
              }
              placeholder="添加备注..."
              maxLength={50}
            />
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              {mode === 'add' ? '添加' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RecordForm;
