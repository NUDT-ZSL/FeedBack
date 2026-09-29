import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { ClothingItem, OutfitRecord, CATEGORY_COLORS, CATEGORY_LABELS, ClothingCategory } from '../types';
import { getStyleFrequency, getCategoryUsage, getTopOutfitCombinations } from '../utils/styleUtils';
import { TrendingUp, PieChart as PieChartIcon, Award } from 'lucide-react';

interface StyleAnalyzerProps {
  items: ClothingItem[];
  records: OutfitRecord[];
}

export const StyleAnalyzer: React.FC<StyleAnalyzerProps> = ({ items, records }) => {
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);
  const [animationKey, setAnimationKey] = useState(0);

  const styleFrequencyData = useMemo(() => {
    const freq = getStyleFrequency(records, items);
    return freq.map(item => ({
      name: item.tag,
      count: item.count,
    }));
  }, [records, items]);

  const categoryUsageData = useMemo(() => {
    const usage = getCategoryUsage(records, items);
    return usage.map(item => ({
      name: CATEGORY_LABELS[item.category],
      value: item.count,
      category: item.category,
    }));
  }, [records, items]);

  const topCombinations = useMemo(() => {
    return getTopOutfitCombinations(records, items, 3);
  }, [records, items]);

  const totalCategoryCount = categoryUsageData.reduce((sum, item) => sum + item.value, 0);

  const renderItemThumbnail = (item: ClothingItem, size: number = 48) => {
    if (item.photoUrl) {
      return (
        <img
          src={item.photoUrl}
          alt={item.name}
          style={{
            width: size,
            height: size,
            borderRadius: '8px',
            objectFit: 'cover',
            border: `2px solid ${CATEGORY_COLORS[item.category]}`,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    }

    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '8px',
          backgroundColor: item.color,
          border: `2px solid ${CATEGORY_COLORS[item.category]}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          color: item.color === '#FFFFFF' || item.color === '#FFFF00' || item.color === '#FFD700' ? '#333' : 'white',
          fontWeight: 500,
        }}
      >
        {CATEGORY_LABELS[item.category].charAt(0)}
      </div>
    );
  };

  const barGradientFill = 'url(#barGradient)';

  return (
    <div className="style-analyzer fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '8px' }}>
          风格分析
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--color-text-light)' }}>
          基于最近30天的穿搭记录分析你的风格偏好
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        <div
          className="chart-card"
          style={{
            backgroundColor: 'var(--color-white)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            padding: '24px',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: 'rgba(52, 152, 219, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3498db',
              }}
            >
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>风格使用频率</h3>
              <p style={{ fontSize: '12px', color: 'var(--color-text-light)' }}>最近30天</p>
            </div>
          </div>

          {styleFrequencyData.length === 0 ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-light)' }}>
              暂无数据
            </div>
          ) : (
            <div style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  key={`bar-${animationKey}`}
                  data={styleFrequencyData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3498db" />
                      <stop offset="100%" stopColor="#2ecc71" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: 'var(--color-text-light)' }}
                    axisLine={{ stroke: '#eee' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'var(--color-text-light)' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      fontSize: '13px',
                    }}
                    formatter={(value: number) => [`${value}次`, '使用次数']}
                  />
                  <Bar
                    dataKey="count"
                    fill={barGradientFill}
                    radius={[6, 6, 0, 0]}
                    animationDuration={500}
                    animationEasing="ease-out"
                    onAnimationStart={() => {}}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div
          className="chart-card"
          style={{
            backgroundColor: 'var(--color-white)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            padding: '24px',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: 'rgba(155, 89, 182, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9b59b6',
              }}
            >
              <PieChartIcon size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>类别使用占比</h3>
              <p style={{ fontSize: '12px', color: 'var(--color-text-light)' }}>最近30天</p>
            </div>
          </div>

          {categoryUsageData.length === 0 ? (
            <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-light)' }}>
              暂无数据
            </div>
          ) : (
            <div style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart key={`pie-${animationKey}`}>
                  <Pie
                    data={categoryUsageData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    animationDuration={500}
                    animationEasing="ease-out"
                    onMouseEnter={(_, index) => setActivePieIndex(index)}
                    onMouseLeave={() => setActivePieIndex(null)}
                    label={({ name, percent }) =>
                      activePieIndex === categoryUsageData.findIndex(d => d.name === name)
                        ? `${name} ${(percent * 100).toFixed(0)}%`
                        : ''
                    }
                    labelLine={false}
                  >
                    {categoryUsageData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CATEGORY_COLORS[entry.category as ClothingCategory]}
                        style={{
                          transform: activePieIndex === index ? 'scale(1.1)' : 'scale(1)',
                          transformOrigin: 'center',
                          transition: 'transform 0.2s ease',
                        }}
                        stroke="white"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      fontSize: '13px',
                    }}
                    formatter={(value: number) => [`${value}次 (${((value / totalCategoryCount) * 100).toFixed(1)}%)`, '使用次数']}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div
        className="top-combinations-section"
        style={{
          backgroundColor: 'var(--color-white)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-sm)',
          padding: '24px',
          flex: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: 'rgba(241, 196, 15, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f39c12',
            }}
          >
            <Award size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>最常搭配组合</h3>
            <p style={{ fontSize: '12px', color: 'var(--color-text-light)' }}>你最爱的3套搭配</p>
          </div>
        </div>

        {topCombinations.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '150px',
            color: 'var(--color-text-light)',
          }}>
            暂无搭配记录
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {topCombinations.map((combo, index) => (
              <div
                key={index}
                className="combo-card"
                style={{
                  flex: 1,
                  minWidth: '200px',
                  backgroundColor: 'var(--color-primary)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  transition: 'all var(--transition-normal)',
                  position: 'relative',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '-8px',
                    left: '16px',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: index === 0 ? '#F1C40F' : index === 1 ? '#BDC3C7' : '#CD7F32',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }}
                >
                  {index + 1}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  {combo.items.map(item => (
                    <div key={item.id} style={{ textAlign: 'center' }}>
                      {renderItemThumbnail(item, 44)}
                      <p style={{ fontSize: '11px', marginTop: '4px', color: 'var(--color-text-light)' }}>
                        {item.name.length > 4 ? item.name.slice(0, 4) + '...' : item.name}
                      </p>
                    </div>
                  ))}
                </div>

                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-accent)' }}>
                    {combo.count}次
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
