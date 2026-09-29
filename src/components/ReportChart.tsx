import { useMemo, useState, memo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import type { Booking, Room, MonthlyReport } from '../types';

interface ReportChartProps {
  bookings: Booking[];
  rooms: Room[];
}

function ReportChart({ bookings, rooms }: ReportChartProps) {
  const [currentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const report = useMemo((): MonthlyReport => {
    const { year, month } = currentMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const completedBookings = bookings.filter(b => {
      if (b.status !== '已退房') return false;
      const bookingDate = new Date(b.checkInDate);
      return bookingDate.getFullYear() === year && bookingDate.getMonth() === month;
    });

    const totalRevenue = completedBookings.reduce((sum, b) => sum + b.totalPrice, 0);
    const totalOrders = completedBookings.length;
    const avgPrice = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    const soldRoomNights = completedBookings.reduce((sum, b) => sum + b.days, 0);
    const totalRoomNights = rooms.length * daysInMonth;
    const occupancyRate = totalRoomNights > 0 ? Math.round((soldRoomNights / totalRoomNights) * 10000) / 100 : 0;

    const dailyRevenue: Array<{ date: string; revenue: number }> = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      let revenue = 0;
      completedBookings.forEach(b => {
        const checkIn = new Date(b.checkInDate);
        const checkOut = new Date(checkIn);
        checkOut.setDate(checkOut.getDate() + b.days);
        const currentDate = new Date(dateStr);
        if (currentDate >= checkIn && currentDate < checkOut) {
          revenue += Math.round(b.totalPrice / b.days);
        }
      });
      dailyRevenue.push({ date: String(day), revenue });
    }

    return {
      year,
      month,
      totalRevenue,
      totalOrders,
      avgPrice,
      occupancyRate,
      dailyRevenue
    };
  }, [bookings, rooms, currentMonth]);

  const gradientId = 'colorRevenue';

  return (
    <div>
      <h1 className="page-title">
        {report.year}年{report.month + 1}月经营报表
      </h1>

      <div className="report-stats">
        <div className="stat-card">
          <div className="stat-label">总收入</div>
          <div className="stat-value">¥{report.totalRevenue.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">订单总数</div>
          <div className="stat-value">{report.totalOrders}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均房价</div>
          <div className="stat-value small">¥{report.avgPrice}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">入住率</div>
          <div className="stat-value small">{report.occupancyRate}%</div>
        </div>
      </div>

      <div className="chart-container">
        <h2 className="chart-title">每日收入趋势</h2>
        <div className="chart-animate" style={{ width: '100%', height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={report.dailyRevenue} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4A90D9" stopOpacity={1} />
                  <stop offset="100%" stopColor="#357ABD" stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: '#666' }}
                axisLine={{ stroke: '#ddd' }}
                label={{ value: '日期', position: 'insideBottom', offset: -5, fill: '#888' }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#666' }}
                axisLine={{ stroke: '#ddd' }}
                label={{ value: '收入(元)', angle: -90, position: 'insideLeft', fill: '#888' }}
              />
              <Tooltip
                formatter={(value: number) => [`¥${value}`, '收入']}
                labelFormatter={(label) => `${report.month + 1}月${label}日`}
                contentStyle={{
                  borderRadius: '8px',
                  border: 'none',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}
              />
              <Bar
                dataKey="revenue"
                name="收入"
                radius={[4, 4, 0, 0]}
                animationDuration={800}
                animationBegin={0}
              >
                {report.dailyRevenue.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={`url(#${gradientId})`}
                    style={{
                      animationDelay: `${index * 15}ms`,
                      animationFillMode: 'backwards'
                    }}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default memo(ReportChart);
