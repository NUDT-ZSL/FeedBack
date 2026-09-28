import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { NumberCard } from './NumberCard';
import { ReportGenerator } from '../modules/report/ReportGenerator';

interface DashboardProps {
  reportGenerator: ReportGenerator;
  refreshKey: number;
}

export const Dashboard: React.FC<DashboardProps> = ({ reportGenerator, refreshKey }) => {
  const barData = useMemo(() => reportGenerator.getPeriodBarChartData(), [reportGenerator, refreshKey]);
  const lineData = useMemo(() => reportGenerator.getLast7DaysTrend(), [reportGenerator, refreshKey]);
  const todayOrders = useMemo(() => reportGenerator.getTodayOrderCount(), [reportGenerator, refreshKey]);
  const monthRevenue = useMemo(() => reportGenerator.getMonthRevenue(), [reportGenerator, refreshKey]);
  const monthProfit = useMemo(() => reportGenerator.getMonthProfit(), [reportGenerator, refreshKey]);

  return (
    <div className="dashboard">
      <div className="dashboard-cards">
        <NumberCard label="今日单数" value={todayOrders} suffix=" 单" />
        <NumberCard label="本月营收" value={monthRevenue} prefix="¥" />
        <NumberCard label="本月利润" value={monthProfit} prefix="¥" />
      </div>

      <div className="charts-row">
        <div className="chart-card">
          <h3 className="chart-title">销售额对比</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 13 }} />
                <YAxis tick={{ fill: '#666', fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`¥${value.toFixed(2)}`, '销售额']}
                />
                <Bar dataKey="销售额" fill="#4a90d9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">近7天销量趋势</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 12 }} />
                <YAxis tick={{ fill: '#666', fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`${value} 本`, '销量']}
                />
                <Line
                  type="monotone"
                  dataKey="销量"
                  stroke="#5cb85c"
                  strokeWidth={2.5}
                  dot={{ fill: '#5cb85c', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: '#5cb85c' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
