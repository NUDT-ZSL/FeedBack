import React, { useCallback, useMemo, useState } from 'react';
import {
  BudgetRecord,
  BudgetRecordDraft,
  Category,
  StorageType,
} from '../types';
import {
  CATEGORIES,
  createRecord,
  filterRecords,
  getCategoryColor,
  updateRecordFromDraft,
} from '../domain/budget';
import { formatCurrency, formatDate } from '../utils/format';
import RecordForm from './RecordForm';

interface RecordListProps {
  records: BudgetRecord[];
  onAdd: (record: BudgetRecord) => void;
  onDelete: (id: string) => void;
  onUpdate: (record: BudgetRecord) => void;
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
  const [editingRecord, setEditingRecord] = useState<BudgetRecord | null>(null);
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const displayRecords = useMemo(
    () => filterRecords(records, filterCategory, filterDate).slice(0, 10),
    [records, filterCategory, filterDate],
  );

  const handleDelete = useCallback((id: string) => {
    setDeletingIds(previous => new Set(previous).add(id));
    setTimeout(() => {
      onDelete(id);
      setDeletingIds(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }, 300);
  }, [onDelete]);

  const openAddForm = (): void => {
    setEditingRecord(null);
    setFormMode('add');
  };

  const openEditForm = (record: BudgetRecord): void => {
    setEditingRecord(record);
    setFormMode('edit');
  };

  const closeForm = (): void => {
    setFormMode(null);
    setEditingRecord(null);
  };

  const handleSubmit = (draft: BudgetRecordDraft): void => {
    if (formMode === 'add') {
      onAdd(createRecord(draft));
    } else if (formMode === 'edit' && editingRecord) {
      onUpdate(updateRecordFromDraft(editingRecord, draft));
    }
    closeForm();
  };

  const resetFilters = (): void => {
    setFilterCategory('all');
    setFilterDate('');
  };

  const hasFilters = filterCategory !== 'all' || Boolean(filterDate);
  const renderCategoryBadge = (category: Category): React.ReactNode => (
    <span className="category-badge">
      <span className="category-dot" style={{ background: getCategoryColor(category) }} />
      {category}
    </span>
  );

  const renderCards = (): React.ReactNode => (
    <div className="records-list">
      {displayRecords.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📒</div>
          <div className="empty-text">暂无记录，点击上方按钮添加第一条</div>
        </div>
      ) : (
        displayRecords.map((record, index) => (
          <div
            key={record.id}
            className={`record-card fade-in-up fade-in-stagger-${Math.min(index + 1, 10)} ${
              deletingIds.has(record.id) ? 'slide-out' : ''
            }`}
            style={{ animationFillMode: 'backwards' }}
          >
            <div className="record-info">
              <span className="category-dot" style={{ background: getCategoryColor(record.category) }} />
              <div className="record-details">
                <div className="record-category">{record.category}</div>
                <div className="record-date">{formatDate(record.date)}</div>
                {record.note && (
                  <div className="record-date" style={{ marginTop: '2px' }}>
                    {record.note}
                  </div>
                )}
              </div>
            </div>
            <div className={`record-amount ${record.type}`}>
              {record.type === 'income' ? '+' : '-'}
              {formatCurrency(record.amount)}
            </div>
            <div className="record-actions">
              <button className="btn btn-secondary btn-small" onClick={() => openEditForm(record)}>
                编辑
              </button>
              <button className="btn btn-danger" onClick={() => handleDelete(record.id)}>
                删除
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderTable = (): React.ReactNode => (
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
              <tr key={record.id} className={deletingIds.has(record.id) ? 'slide-out' : ''}>
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
                    onClick={() => openEditForm(record)}
                  >
                    编辑
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDelete(record.id)}>
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
              onChange={event => onStorageTypeChange(event.target.value as StorageType)}
              style={{ padding: '4px 8px', fontSize: '12px' }}
            >
              <option value="localStorage">LocalStorage</option>
              <option value="indexedDB">IndexedDB</option>
            </select>
          </div>
          <div className="view-toggle">
            <button className={`view-btn ${viewMode === 'cards' ? 'active' : ''}`} onClick={() => setViewMode('cards')}>
              卡片
            </button>
            <button className={`view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>
              表格
            </button>
          </div>
          <button className="btn btn-primary" onClick={openAddForm}>
            + 添加记录
          </button>
        </div>
      </div>

      <div className="filters">
        <select
          className="filter-select"
          value={filterCategory}
          onChange={event => setFilterCategory(event.target.value)}
        >
          <option value="all">全部类别</option>
          {CATEGORIES.map(category => (
            <option key={category.name} value={category.name}>{category.name}</option>
          ))}
        </select>
        <input
          type="date"
          className="filter-input"
          value={filterDate}
          onChange={event => setFilterDate(event.target.value)}
          placeholder="选择日期"
        />
        {hasFilters ? (
          <button className="btn btn-secondary btn-small" onClick={resetFilters}>
            清除筛选
          </button>
        ) : null}
      </div>

      {viewMode === 'cards' ? renderCards() : renderTable()}
      {formMode ? (
        <RecordForm
          mode={formMode}
          initialRecord={editingRecord}
          onSubmit={handleSubmit}
          onClose={closeForm}
        />
      ) : null}
    </div>
  );
};

export default React.memo(RecordList);
