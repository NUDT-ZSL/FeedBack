import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Header from './Header';
import RecordList from './RecordList';
import BudgetChart from './BudgetChart';
import { Record, StorageType } from './types';
import { 
  getAllRecords, 
  addRecord, 
  updateRecord, 
  deleteRecord, 
  setStorageType,
  getStorageType 
} from './data';

const App: React.FC = () => {
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageType, setStorageTypeState] = useState<StorageType>('localStorage');

  const loadRecords = useCallback(async () => {
    setLoading(true);
    const startTime = performance.now();
    try {
      const data = await getAllRecords();
      setRecords(data);
      const endTime = performance.now();
      console.debug(`[App] 数据加载耗时: ${(endTime - startTime).toFixed(2)}ms, 记录数: ${data.length}`);
    } catch (error) {
      console.error('加载记录失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords, storageType]);

  useEffect(() => {
    if (records.length > 0) {
      const renderStartTime = performance.now();
      requestAnimationFrame(() => {
        const renderEndTime = performance.now();
        console.debug(`[App] 渲染完成耗时: ${(renderEndTime - renderStartTime).toFixed(2)}ms`);
      });
    }
  }, [records]);

  const handleAdd = useCallback(async (record: Record) => {
    const startTime = performance.now();
    try {
      await addRecord(record);
      await loadRecords();
      const endTime = performance.now();
      console.debug(`[App] 添加记录+重绘总耗时: ${(endTime - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error('添加记录失败:', error);
    }
  }, [loadRecords]);

  const handleDelete = useCallback(async (id: string) => {
    const startTime = performance.now();
    try {
      await deleteRecord(id);
      await loadRecords();
      const endTime = performance.now();
      console.debug(`[App] 删除记录+重绘总耗时: ${(endTime - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error('删除记录失败:', error);
    }
  }, [loadRecords]);

  const handleUpdate = useCallback(async (record: Record) => {
    const startTime = performance.now();
    try {
      await updateRecord(record);
      await loadRecords();
      const endTime = performance.now();
      console.debug(`[App] 更新记录+重绘总耗时: ${(endTime - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error('更新记录失败:', error);
    }
  }, [loadRecords]);

  const handleStorageTypeChange = useCallback((type: StorageType) => {
    setStorageType(type);
    setStorageTypeState(type);
    console.log(`[App] 存储方式切换为: ${type}`);
  }, []);

  const currentMonthStats = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const monthRecords = records.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate.getFullYear() === currentYear && 
             recordDate.getMonth() === currentMonth;
    });

    const totalIncome = monthRecords
      .filter(r => r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0);

    const totalExpense = monthRecords
      .filter(r => r.type === 'expense')
      .reduce((sum, r) => sum + r.amount, 0);

    const balance = totalIncome - totalExpense;

    return { totalIncome, totalExpense, balance };
  }, [records]);

  if (loading) {
    return (
      <div className="app-container" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <div className="empty-text">加载中...</div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <h1 className="app-title">💰 个人财务预算管理</h1>
        <p className="app-subtitle">记录每一笔收支，掌控财务自由</p>
      </div>

      <Header
        totalIncome={currentMonthStats.totalIncome}
        totalExpense={currentMonthStats.totalExpense}
        balance={currentMonthStats.balance}
      />

      <div className="main-content">
        <div className="section fade-in-up fade-in-stagger-4">
          <RecordList
            records={records}
            onAdd={handleAdd}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            storageType={storageType}
            onStorageTypeChange={handleStorageTypeChange}
          />
        </div>
        <div className="section fade-in-up fade-in-stagger-5">
          <div className="section-header">
            <h2 className="section-title">本月支出分布</h2>
          </div>
          <BudgetChart records={records} />
        </div>
      </div>

      <div style={{ 
        textAlign: 'center', 
        marginTop: '32px', 
        paddingTop: '24px', 
        borderTop: '1px solid var(--border-color)',
        color: 'var(--text-light)',
        fontSize: '12px',
      }}>
        <p>💡 小提示：点击"添加记录"开始记账，数据保存在浏览器本地</p>
        <p style={{ marginTop: '4px' }}>
          当前存储方式: <strong style={{ color: 'var(--primary-color)' }}>
            {getStorageType()}
          </strong>
        </p>
      </div>
    </div>
  );
};

export default App;
