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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export interface CareLog {
  id: string;
  date: string;
  activityType: 'water' | 'fertilize' | 'prune';
  notes: string;
}

export interface Plant {
  id: string;
  name: string;
  species: string;
  photoFileName?: string;
  logs: CareLog[];
  createdAt: string;
}

export function generateWaterTrendData(logs: CareLog[]) {
  const now = new Date();
  const labels: string[] = [];
  const data: number[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const shortLabel = `${d.getMonth() + 1}/${d.getDate()}`;
    labels.push(shortLabel);
    const count = logs.filter(
      (l) => l.activityType === 'water' && l.date === dateStr
    ).length;
    data.push(count);
  }

  return {
    labels,
    datasets: [
      {
        label: '浇水次数',
        data,
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
          const chart = ctx.chart;
          const { ctx: canvasCtx, chartArea } = chart;
          if (!chartArea) return 'rgba(54, 162, 235, 0.1)';
          const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(54, 162, 235, 0.4)');
          gradient.addColorStop(1, 'rgba(54, 162, 235, 0.02)');
          return gradient;
        },
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgba(54, 162, 235, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        borderWidth: 2,
      },
    ],
  };
}

export function waterTrendOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 100,
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 5,
        ticks: { stepSize: 1, color: '#888' },
        grid: { color: 'rgba(0,0,0,0.06)' },
      },
      x: {
        ticks: {
          color: '#888',
          maxRotation: 45,
          autoSkip: true,
          maxTicksLimit: 10,
        },
        grid: { display: false },
      },
    },
    plugins: {
      legend: {
        position: 'topright' as const,
        labels: { color: '#555', usePointStyle: true, pointStyle: 'circle' },
      },
      tooltip: {
        backgroundColor: 'rgba(255,255,255,0.95)',
        titleColor: '#333',
        bodyColor: '#555',
        borderColor: '#ddd',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10,
      },
    },
  };
}

export function generateFertilizeBarData(logs: CareLog[]) {
  const now = new Date();
  const labels: string[] = [];
  const data: number[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const shortLabel = `${d.getMonth() + 1}月`;
    labels.push(shortLabel);
    const count = logs.filter(
      (l) =>
        l.activityType === 'fertilize' &&
        l.date.startsWith(monthStr)
    ).length;
    data.push(count);
  }

  return {
    labels,
    datasets: [
      {
        label: '施肥次数',
        data,
        backgroundColor: 'rgba(255, 159, 64, 0.7)',
        borderColor: 'rgba(255, 159, 64, 1)',
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  };
}

export function fertilizeBarOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 100,
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { stepSize: 1, color: '#888' },
        grid: { color: 'rgba(0,0,0,0.06)' },
      },
      x: {
        ticks: { color: '#888' },
        grid: { display: false },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
    },
  };
}
