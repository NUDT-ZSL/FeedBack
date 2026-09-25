import React from 'react';
import { formatCurrency } from '../utils/format';

interface HeaderProps {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

const Header: React.FC<HeaderProps> = ({
  totalIncome,
  totalExpense,
  balance,
}) => {
  const balanceClassName = balance < 0
    ? 'stat-value balance-negative'
    : 'stat-value';

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
        <div className={balanceClassName}>{formatCurrency(balance)}</div>
      </div>
    </div>
  );
};

export default React.memo(Header);
