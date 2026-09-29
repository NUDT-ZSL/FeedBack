import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPalette, FaClock, FaStar, FaHeart, FaPlus } from 'react-icons/fa';
import { Work } from '../types';
import { WorkCard } from './WorkCard';
import { useCountUp } from '../hooks/useCountUp';
import { useRipple } from '../hooks/useRipple';

interface StatsPanelProps {
  works: Work[];
}

export const StatsPanel: React.FC<StatsPanelProps> = ({ works }) => {
  const navigate = useNavigate();
  const [animateStart] = useState(true);
  const createRipple = useRipple('rgba(62, 39, 35, 0.3)');

  const totalWorks = works.length;
  const totalDuration = works.reduce((sum, work) =>
    sum + work.steps.reduce((s, step) => s + step.duration, 0), 0);
  const averageRating = works.reduce((sum, work) => {
    const avg = work.comments.length > 0
      ? work.comments.reduce((s, c) => s + c.rating, 0) / work.comments.length
      : 0;
    return sum + avg;
  }, 0) / (works.length || 1);
  const totalFavorites = works.reduce((sum, work) => sum + work.favorites, 0);

  const displayWorks = useCountUp(totalWorks, 1000, animateStart);
  const displayDuration = useCountUp(totalDuration, 1000, animateStart);
  const displayRating = useCountUp(Math.round(averageRating * 10), 1000, animateStart) / 10;
  const displayFavorites = useCountUp(totalFavorites, 1000, animateStart);

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const statCards = [
    {
      label: '作品总数',
      value: displayWorks,
      suffix: '件',
      icon: FaPalette,
      bgColor: 'var(--stats-blue)',
      iconColor: '#1976D2',
    },
    {
      label: '总耗时',
      value: formatDuration(displayDuration),
      suffix: '',
      icon: FaClock,
      bgColor: 'var(--stats-green)',
      iconColor: '#388E3C',
    },
    {
      label: '平均评分',
      value: displayRating.toFixed(1),
      suffix: '',
      icon: FaStar,
      bgColor: 'var(--stats-yellow)',
      iconColor: '#FFA000',
    },
    {
      label: '总收藏',
      value: displayFavorites,
      suffix: '次',
      icon: FaHeart,
      bgColor: 'var(--stats-pink)',
      iconColor: '#E91E63',
    },
  ];

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      <header style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>我的手工艺作品</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '16px' }}>记录每一件作品的创作历程</p>
        </div>
        <button
          className="ripple-container"
          onClick={(e) => {
            createRipple(e);
            setTimeout(() => navigate('/create'), 100);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            backgroundColor: 'var(--text-title)',
            color: '#FFFFFF',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 500,
            transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
            boxShadow: '0 4px 12px rgba(62, 39, 35, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(62, 39, 35, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(62, 39, 35, 0.3)';
          }}
        >
          <FaPlus size={18} />
          创建新作品
        </button>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
          marginBottom: '40px',
        }}
      >
        {statCards.map((card, index) => (
          <div
            key={card.label}
            style={{
              backgroundColor: card.bgColor,
              borderRadius: 'var(--radius-card)',
              padding: '24px',
              transition: 'box-shadow 0.3s var(--easing-standard), transform 0.3s var(--easing-standard)',
              animation: `countUp 0.6s var(--easing-standard) both`,
              animationDelay: `${index * 0.1}s`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.08), 0 0 12px ${card.iconColor}44`;
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'var(--shadow-card)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: card.iconColor,
                }}
              >
                <card.icon size={24} />
              </div>
              <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>
                {card.label}
              </span>
            </div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: 'var(--text-title)', lineHeight: 1 }}>
              {card.value}
              <span style={{ fontSize: '18px', marginLeft: '4px' }}>{card.suffix}</span>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>作品列表</h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '24px',
        }}
      >
        {works.map((work) => (
          <WorkCard key={work.id} work={work} />
        ))}
      </div>

      <style>{`
        @media (max-width: 1023px) {
          div[style*="grid-template-columns: repeat(3"] {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 767px) {
          div[style*="grid-template-columns: repeat(3"],
          div[style*="grid-template-columns: repeat(2"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};
