import React, { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Record, RecordType, Category, CATEGORIES, getCategoryColor, StorageType } from './types';

interface RecordListProps {
  records: Record[];
  onAdd: (record: Record) => void;
  onDelete: (id: string) => void;
  onUpdate: (record: Record) => void;
  storageType: StorageType;
  onStorageTypeChange: (type: StorageType) => void;
}

type ViewMode = 'cards' | 'table';
type FormMode = 'add' | 'edit' | null;

const RecordList: React.FC<RecordListProps> = ({
  records,
  onAdd,
  onDelete,
  onUpdate,
  storageType,
  onStorageTypeChange,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingRecord, setEditingRecord] = useState<Record | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    type: 'expense' as RecordType,
    amount: '',
    category: '餐饮' as Category,
    date: new Date().toISOString().split('T')[0],
    note: '',
  });

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const filteredRecords = React.useMemo(() => {
    return records.filter(record => {
      if (filterCategory !== 'all' && record.category !== filterCategory) return false;
      if (filterDate && record.date !== filterDate) return false;
      return true;
    });
  }, [records, filterCategory, filterDate]);

  const displayRecords = filteredRecords.slice(0, 10);

  const handleDelete = useCallback((id: string) => {
    setDeletingIds(prev => new Set(prev).add(id));
    
    setTimeout(() => {
      onDelete(id);
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300);
  }, [onDelete]);

  const handleAddClick = () => {
    setFormMode('add');
    setEditingRecord(null);
    setFormData({
      type: 'expense',
      amount: '',
      category: '餐饮',
      date: new Date().toISOString().split('T')[0],
      note: '',
    });
  };

  const handleEditClick = (record: Record) => {
    setFormMode('edit');
    setEditingRecord(record);
    setFormData({
      type: record.type,
      amount: record.amount.toString(),
      category: record.category,
      date: record.date,
      note: record.note || '',
    });
  };

  const handleCloseForm = () => {
    setFormMode(null);
    setEditingRecord(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      alert('请输入有效的金额');
      return;
    }

    if (formMode === 'add') {
      const newRecord: Record = {
        id: uuidv4(),
        type: formData.type,
        amount,
        category: formData.category,
        date: formData.date,
        note: formData.note || undefined,
      };
      onAdd(newRecord);
    } else if (formMode === 'edit' && editingRecord) {
      const updatedRecord: Record = {
        ...editingRecord,
        type: formData.type,
        amount,
        category: formData.category,
        date: formData.date,
        note: formData.note || undefined,
      };
      onUpdate(updatedRecord);
    }

    handleCloseForm();
  };

  const getRecordCardClassName = (record: Record, index: number): string => {
    const classes = ['record-card', 'fade-in-up', `fade-in-stagger-${Math.min(index + 1, 10)}`];
    if (deletingIds.has(record.id)) {
      classes.push('slide-out');
    }
    return classes.join(' ');
  };

  const getTableRowClassName = (record: Record): string => {
    return deletingIds.has(record.id) ? 'slide-out' : '';
  };

  const availableCategories = CATEGORIES.filter(c => c.type === formData.type);

  const renderCategoryBadge = (category: Category) => (
    <span className="category-badge">
      <span className="category-dot" style={{ background: getCategoryColor(category) }} />
      {category}
    </span>
  );

  const renderCards = () => (
    <div className="records-list">
      {displayRecords.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📝</div>
          <div className="empty-text">暂无记录，点击上方按钮添加第一条</div>
        </div>
      ) : (
        displayRecords.map((record, index) => (
          <div
            key={record.id}
            className={getRecordCardClassName(record, index)}
            style={{ animationFillMode: 'backwards' }}
          >
            <div className="record-info">
              <span className="category-dot" style={{ background: getCategoryColor(record.category) }} />
              <div className="record-details">
                <div className="record-category">{record.category}</div>
                <div className="record-date">{formatDate(record.date)}</div>
                {record.note && (
                  <div className="record-date" style={{ marginTop: '2px' }}>{record.note}</div>
                )}
              </div>
            </div>
            <div className={`record-amount ${record.type}`}>
              {record.type === 'income' ? '+' : '-'}{formatCurrency(record.amount)}
            </div>
            <div className="record-actions">
              <button
                className="btn btn-secondary btn-small"
                onClick={() => handleEditClick(record)}
              >
                编辑
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(record.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderTable = () => (
    <div className="table-container">
      <table className="records-table">
        <thead>
          <tr>
            <th>类别</th>
            <th>类型</th>
            <th>金额</th>
            <th>日期</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {displayRecords.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: '48px 16px' }}>
                <div className="empty-text">暂无记录</div>
              </td>
            </tr>
          ) : (
            displayRecords.map(record => (
              <tr key={record.id} className={getTableRowClassName(record)}>
                <td>{renderCategoryBadge(record.category)}</td>
                <td>
                  <span style={{ 
                    color: record.type === 'income' ? '#27AE60' : '#E74C3C',
                    fontWeight: 500,
                  }}>
                    {record.type === 'income' ? '收入' : '支出'}
                  </span>
                </td>
                <td className={`record-amount ${record.type}`} style={{ fontSize: '14px' }}>
                  {record.type === 'income' ? '+' : '-'}{formatCurrency(record.amount)}
                </td>
                <td>{formatDate(record.date)}</td>
                <td style={{ color: '#999' }}>{record.note || '-'}</td>
                <td>
                  <button
                    className="btn btn-secondary btn-small"
                    style={{ marginRight: '8px' }}
                    onClick={() => handleEditClick(record)}
                  >
                    编辑
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(record.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderForm = () => {
    if (!formMode) return null;

    return (
      <div className="form-overlay" onClick={handleCloseForm}>
        <div className="form-modal" onClick={e => e.stopPropagation()}>
          <h2 className="form-title">
            {formMode === 'add' ? '添加记录' : '编辑记录'}
          </h2>
          <form onSubmit={handleSubmit}>
            <div className="type-toggle">
              <button
                type="button"
                className={`type-btn ${formData.type === 'income' ? 'active-income' : ''}`}
                onClick={() => setFormData({ ...formData, type: 'income', category: '工资' })}
              >
                收入
              </button>
              <button
                type="button"
                className={`type-btn ${formData.type === 'expense' ? 'active-expense' : ''}`}
                onClick={() => setFormData({ ...formData, type: 'expense', category: '餐饮' })}
              >
                支出
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">类别</label>
              <select
                className="form-select"
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value as Category })}
                required
              >
                {availableCategories.map(cat => (
                  <option key={cat.name} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">金额</label>
              <input
                type="number"
                className="form-input"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
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
                onChange={e => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">备注（可选）</label>
              <input
                type="text"
                className="form-input"
                value={formData.note}
                onChange={e => setFormData({ ...formData, note: e.target.value })}
                placeholder="添加备注..."
                maxLength={50}
              />
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseForm}
              >
                取消
              </button>
              <button type="submit" className="btn btn-primary">
                {formMode === 'add' ? '添加' : '保存'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">最近记录</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="storage-toggle">
            <span>存储:</span>
            <select
              className="filter-select"
              value={storageType}
              onChange={e => onStorageTypeChange(e.target.value as StorageType)}
              style={{ padding: '4px 8px', fontSize: '12px' }}
            >
              <option value="localStorage">LocalStorage</option>
              <option value="indexedDB">IndexedDB</option>
            </select>
          </div>
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => setViewMode('cards')}
            >
              卡片
            </button>
            <button
              className={`view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              表格
            </button>
          </div>
          <button className="btn btn-primary" onClick={handleAddClick}>
            + 添加记录
          </button>
        </div>
      </div>

      <div className="filters">
        <select
          className="filter-select"
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
        >
          <option value="all">全部类别</option>
          {CATEGORIES.map(cat => (
            <option key={cat.name} value={cat.name}>{cat.name}</option>
          ))}
        </select>
        <input
          type="date"
          className="filter-input"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          placeholder="选择日期"
        />
        {filterCategory !== 'all' || filterDate ? (
          <button
            className="btn btn-secondary btn-small"
            onClick={() => {
              setFilterCategory('all');
              setFilterDate('');
            }}
          >
            清除筛选
          </button>
        ) : null}
      </div>

      {viewMode === 'cards' ? renderCards() : renderTable()}
      {renderForm()}
    </div>
  );
};

export default React.memo(RecordList);
