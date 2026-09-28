import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';
import { BattleStats } from '../types';

interface StatsPanelProps {
  player1Name: string;
  player2Name: string;
  stats: {
    player1: BattleStats;
    player2: BattleStats;
  };
  winner: string | null;
}

const StatsPanel: React.FC<StatsPanelProps> = ({
  player1Name,
  player2Name,
  stats,
  winner,
}) => {
  const barData = [
    {
      name: '总伤害',
      [player1Name]: stats.player1.totalDamage,
      [player2Name]: stats.player2.totalDamage,
    },
    {
      name: '总治疗',
      [player1Name]: stats.player1.totalHeal,
      [player2Name]: stats.player2.totalHeal,
    },
    {
      name: '技能使用率(%)',
      [player1Name]: stats.player1.skillHitRate,
      [player2Name]: stats.player2.skillHitRate,
    },
    {
      name: '有效输出(%)',
      [player1Name]: stats.player1.effectiveOutputTime,
      [player2Name]: stats.player2.effectiveOutputTime,
    },
  ];

  const radarData = [
    {
      subject: '伤害输出',
      [player1Name]: Math.min(100, (stats.player1.totalDamage / 500) * 100),
      [player2Name]: Math.min(100, (stats.player2.totalDamage / 500) * 100),
      fullMark: 100,
    },
    {
      subject: '治疗能力',
      [player1Name]: Math.min(100, (stats.player1.totalHeal / 300) * 100),
      [player2Name]: Math.min(100, (stats.player2.totalHeal / 300) * 100),
      fullMark: 100,
    },
    {
      subject: '技能频率',
      [player1Name]: stats.player1.skillHitRate,
      [player2Name]: stats.player2.skillHitRate,
      fullMark: 100,
    },
    {
      subject: '输出效率',
      [player1Name]: stats.player1.effectiveOutputTime,
      [player2Name]: stats.player2.effectiveOutputTime,
      fullMark: 100,
    },
  ];

  const gradientColors = {
    player1: ['#2196f3', '#1976d2'],
    player2: ['#f44336', '#d32f2f'],
  };

  return (
    <div className="panel stats-panel">
      <h2>战斗统计</h2>

      {winner && (
        <div className="battle-result-winner">
          <h3>🏆 {winner} 获胜！</h3>
        </div>
      )}

      <div className="chart-section">
        <h3>数据对比（柱状图）</h3>
        <div className="bar-chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.6)" fontSize={12} />
              <YAxis stroke="rgba(255,255,255,0.6)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(30, 40, 55, 0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#fff',
                }}
                labelStyle={{ color: '#fff', fontWeight: 'bold' }}
              />
              <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.7)' }} />
              <defs>
                <linearGradient id="colorP1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={gradientColors.player1[0]} />
                  <stop offset="100%" stopColor={gradientColors.player1[1]} />
                </linearGradient>
                <linearGradient id="colorP2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={gradientColors.player2[0]} />
                  <stop offset="100%" stopColor={gradientColors.player2[1]} />
                </linearGradient>
              </defs>
              <Bar dataKey={player1Name} fill="url(#colorP1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey={player2Name} fill="url(#colorP2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-section">
        <h3>能力雷达图</h3>
        <div className="radar-chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="80%">
              <PolarGrid stroke="#e0e0e0" strokeOpacity={0.3} />
              <PolarAngleAxis dataKey="subject" tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 12 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} />
              <Radar
                name={player1Name}
                dataKey={player1Name}
                stroke="#2196f3"
                strokeWidth={3}
                fill="#2196f3"
                fillOpacity={0.3}
                dot={{ r: 4, strokeWidth: 2 }}
              />
              <Radar
                name={player2Name}
                dataKey={player2Name}
                stroke="#f44336"
                strokeWidth={3}
                fill="#f44336"
                fillOpacity={0.3}
                dot={{ r: 4, strokeWidth: 2 }}
              />
              <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.7)' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(30, 40, 55, 0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#fff',
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default StatsPanel;
