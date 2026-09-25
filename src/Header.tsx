import React from 'react';

interface HeaderProps {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

const Header: React.FC<HeaderProps> = ({ totalIncome, totalExpense, balance }) => {
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getBalanceClassName = (): string => {
    const classes = ['stat-value'];
    if (balance < 0) {
      classes.push('balance-negative');
    }
    return classes.join(' ');
  };

  return (
    <div className="stats-container">
      <div className="stat-card fade-in-up fade-in-stagger-1">
        <div className="stat-label">本月收入</div>
        <div className="stat-value income">{formatCurrency(totalIncome)}</div>
      </div>
      <div className="stat-card fade-in-up fade-in-stagger-2">
        <div className="stat-label">本月支出</div>
        <div className="stat-value expense">{formatCurrency(totalExpense)}</div>
      </div>
      <div className="stat-card fade-in-up fade-in-stagger-3">
        <div className="stat-label">本月结余</div>
        <div className={getBalanceClassName()}>{formatCurrency(balance)}</div>
      </div>
    </div>
  );
};

export default React.memo(Header);
