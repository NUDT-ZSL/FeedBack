import { useEffect, useRef, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartData,
} from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';
import { useDebounce } from '@/hooks/useDebounce';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

interface ChartViewProps {
  byYear: Record<number, number>;
  byContinent: Record<string, number>;
}

const CONTINENT_COLORS = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c'];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function createGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  startColor: string,
  endColor: string
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  const start = hexToRgb(startColor);
  const end = hexToRgb(endColor);
  gradient.addColorStop(0, `rgb(${start.r}, ${start.g}, ${start.b})`);
  gradient.addColorStop(1, `rgb(${end.r}, ${end.g}, ${end.b})`);
  return gradient;
}

export default function ChartView({ byYear, byContinent }: ChartViewProps) {
  const debouncedByYear = useDebounce(byYear, 150);
  const debouncedByContinent = useDebounce(byContinent, 150);
  const barChartRef = useRef<ChartJS<'bar'>>(null);

  const sortedYears = useMemo(
    () => Object.keys(debouncedByYear).sort((a, b) => Number(a) - Number(b)),
    [debouncedByYear]
  );

  const barData: ChartData<'bar'> = useMemo(() => {
    const labels = sortedYears;
    const values = sortedYears.map((year) => debouncedByYear[Number(year)] || 0);
    return {
      labels,
      datasets: [
        {
          label: '旅行次数',
          data: values,
          backgroundColor: (context) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return '#3498db';
            return createGradient(ctx, chartArea.width, '#3498db', '#2ecc71');
          },
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    };
  }, [sortedYears, debouncedByYear]);

  const barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: '每年旅行次数',
        font: { size: 14, weight: 'bold' },
        color: '#374151',
        padding: { bottom: 16 },
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleFont: { size: 12 },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 6,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#6b7280', font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: '#f3f4f6' },
        ticks: {
          color: '#6b7280',
          font: { size: 11 },
          stepSize: 1,
        },
      },
    },
  };

  const continentEntries = useMemo(
    () => Object.entries(debouncedByContinent).filter(([, value]) => value > 0),
    [debouncedByContinent]
  );

  const pieData: ChartData<'pie'> = useMemo(() => {
    return {
      labels: continentEntries.map(([name]) => name),
      datasets: [
        {
          data: continentEntries.map(([, value]) => value),
          backgroundColor: CONTINENT_COLORS.slice(0, continentEntries.length),
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    };
  }, [continentEntries]);

  const pieOptions: ChartOptions<'pie'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      title: {
        display: true,
        text: '各大洲分布',
        font: { size: 14, weight: 'bold' },
        color: '#374151',
        padding: { bottom: 16 },
      },
      legend: {
        position: 'bottom',
        labels: {
          color: '#6b7280',
          font: { size: 11 },
          padding: 12,
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleFont: { size: 12 },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 6,
      },
    },
  };

  useEffect(() => {
    if (barChartRef.current) {
      barChartRef.current.update('none');
    }
  }, [barData]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full h-full">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 min-h-[320px]">
        <div className="w-full h-[280px]">
          <Bar ref={barChartRef} data={barData} options={barOptions} />
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 min-h-[320px]">
        <div className="w-full h-[280px]">
          {continentEntries.length > 0 ? (
            <Pie data={pieData} options={pieOptions} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              暂无数据
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
