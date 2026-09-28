import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import type { Task } from './App';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface StatsChartProps {
  tasks: Task[];
}

function getWeekDates(): Date[] {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function StatsChart({ tasks }: StatsChartProps) {
  const weekDates = useMemo(() => getWeekDates(), []);

  const lineData = useMemo(() => {
    const createdPerDay = new Array(7).fill(0);
    const completedPerDay = new Array(7).fill(0);

    for (const task of tasks) {
      const createdDate = task.createdAt.split('T')[0];
      const createdIdx = weekDates.findIndex((d) => formatDate(d) === createdDate);
      if (createdIdx >= 0) createdPerDay[createdIdx]++;

      if (task.completedAt) {
        const completedDate = task.completedAt.split('T')[0];
        const completedIdx = weekDates.findIndex((d) => formatDate(d) === completedDate);
        if (completedIdx >= 0) completedPerDay[completedIdx]++;
      }
    }

    return {
      labels: WEEKDAY_LABELS,
      datasets: [
        {
          label: '新增任务',
          data: createdPerDay,
          borderColor: '#1976d2',
          backgroundColor: 'rgba(25, 118, 210, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        {
          label: '完成任务',
          data: completedPerDay,
          borderColor: '#388e3c',
          backgroundColor: 'rgba(56, 142, 60, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [tasks, weekDates]);

  const barData = useMemo(() => {
    const pendingByAssignee: Record<string, number> = {};
    for (const task of tasks) {
      if (task.status !== 'done' && task.assignee) {
        pendingByAssignee[task.assignee] = (pendingByAssignee[task.assignee] || 0) + 1;
      }
    }
    const labels = Object.keys(pendingByAssignee).sort();
    const data = labels.map((l) => pendingByAssignee[l]);

    return {
      labels,
      datasets: [
        {
          label: '未完成任务数',
          data,
          backgroundColor: labels.map((_, i) => {
            const colors = [
              'rgba(25, 118, 210, 0.7)',
              'rgba(245, 124, 0, 0.7)',
              'rgba(56, 142, 60, 0.7)',
              'rgba(156, 39, 176, 0.7)',
              'rgba(233, 30, 99, 0.7)',
              'rgba(0, 188, 212, 0.7)',
            ];
            return colors[i % colors.length];
          }),
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    };
  }, [tasks]);

  const lineOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' as const },
        title: { display: false },
        tooltip: {
          mode: 'index' as const,
          intersect: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
        },
      },
    }),
    [],
  );

  const barOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
        },
      },
    }),
    [],
  );

  const weekRange = `${formatDate(weekDates[0])} ~ ${formatDate(weekDates[6])}`;

  return (
    <div className="stats-container">
      <div className="charts-grid">
        <div className="chart-card">
          <h3>每周任务趋势 ({weekRange})</h3>
          <div className="chart-wrapper">
            <Line data={lineData} options={lineOptions} />
          </div>
        </div>
        <div className="chart-card">
          <h3>各负责人未完成任务</h3>
          <div className="chart-wrapper">
            <Bar data={barData} options={barOptions} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default StatsChart;
