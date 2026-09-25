import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BudgetRecord, CategoryExpense } from '../types';
import { getExpensesByCategory } from '../domain/budget';
import { logger } from '../utils/logger';

interface BudgetChartProps {
  records: BudgetRecord[];
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: { payload: CategoryExpense }[];
}

const BudgetChart: React.FC<BudgetChartProps> = ({ records }) => {
  const chartData = useMemo(() => {
    const startTime = performance.now();
    const data = getExpensesByCategory(records);
    logger.debug(
      `[BudgetChart] 数据计算耗时: ${(performance.now() - startTime).toFixed(2)}ms`,
    );
    return data;
  }, [records]);

  if (chartData.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <div className="empty-text">本月暂无支出记录</div>
      </div>
    );
  }

  return (
    <div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E0" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 12, fill: '#666' }}
              axisLine={{ stroke: '#E8E8E0' }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#666' }}
              axisLine={{ stroke: '#E8E8E0' }}
              tickFormatter={value => `¥${value}`}
            />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              dataKey="amount"
              radius={[6, 6, 0, 0]}
              animationDuration={200}
              animationEasing="ease-out"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {chartData.map(item => (
          <div key={item.category} className="legend-item">
            <span className="legend-dot" style={{ background: item.color }} />
            <span>{item.category}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default React.memo(BudgetChart);

const ChartTooltip: React.FC<ChartTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0].payload;
  return (
    <div
      style={{
        background: '#fff',
        padding: '12px 16px',
        border: '1px solid #E8E8E0',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontWeight: 600,
          marginBottom: '4px',
        }}
      >
        <span
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: data.color,
          }}
        />
        {data.category}
      </div>
      <div style={{ color: '#666', fontSize: '14px' }}>
        支出: ¥{data.amount.toFixed(2)}
      </div>
    </div>
  );
};
