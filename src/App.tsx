import React, { useMemo } from 'react';
import BudgetChart from './components/BudgetChart';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import RecordList from './components/RecordList';
import { getMonthlyStats } from './domain/budget';
import { useBudgetRecords } from './hooks/useBudgetRecords';

const BudgetTracker: React.FC = () => {
  const {
    records,
    loading,
    loadError,
    mutationError,
    storageType,
    refresh,
    add,
    update,
    remove,
    changeStorageType,
    dismissMutationError,
  } = useBudgetRecords();

  const currentMonthStats = useMemo(
    () => getMonthlyStats(records),
    [records],
  );

  if (loading && records.length === 0) {
    return (
      <div className="app-container" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <div className="empty-text">加载中...</div>
      </div>
    );
  }

  if (loadError && records.length === 0) {
    return (
      <div className="app-container">
        <div className="error-page" role="alert">
          <h1 className="error-title">暂时无法读取记录</h1>
          <p className="error-message">{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={refresh}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <h1 className="app-title">💰 个人财务预算管理</h1>
        <p className="app-subtitle">记录每一笔收支，掌控财务自由</p>
      </div>

      {loadError ? (
        <div className="error-banner" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="error-banner-action"
            onClick={refresh}
          >
            重试
          </button>
        </div>
      ) : mutationError ? (
        <div className="error-banner" role="alert">
          <span>{mutationError}</span>
          <button
            type="button"
            className="error-banner-action"
            onClick={dismissMutationError}
          >
            知道了
          </button>
        </div>
      ) : null}

      <Header
        totalIncome={currentMonthStats.totalIncome}
        totalExpense={currentMonthStats.totalExpense}
        balance={currentMonthStats.balance}
      />

      <div className="main-content">
        <div className="section fade-in-up fade-in-stagger-4">
          <RecordList
            records={records}
            onAdd={add}
            onDelete={remove}
            onUpdate={update}
            storageType={storageType}
            onStorageTypeChange={changeStorageType}
          />
        </div>
        <div className="section fade-in-up fade-in-stagger-5">
          <div className="section-header">
            <h2 className="section-title">本月支出分布</h2>
          </div>
          <BudgetChart records={records} />
        </div>
      </div>

      <div
        style={{
          textAlign: 'center',
          marginTop: '32px',
          paddingTop: '24px',
          borderTop: '1px solid var(--border-color)',
          color: 'var(--text-light)',
          fontSize: '12px',
        }}
      >
        <p>💡 小提示：点击"添加记录"开始记账，数据保存在浏览器本地</p>
        <p style={{ marginTop: '4px' }}>
          当前存储方式:{' '}
          <strong style={{ color: 'var(--primary-color)' }}>
            {storageType}
          </strong>
        </p>
      </div>
    </div>
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <BudgetTracker />
  </ErrorBoundary>
);

export default App;
