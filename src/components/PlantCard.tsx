import React, { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Plant } from '../types';
import { categoryConfig, difficultyStars } from '../types';
import { getDaysSince, isDateExpiredOrToday, formatDate } from '../utils';
import { Droplets, Leaf, Flower, Sprout, TreePine } from 'lucide-react';

interface PlantCardProps {
  plant: Plant;
}

const categoryIcons = {
  succulent: <Sprout size={24} color="white" />,
  green: <Leaf size={24} color="white" />,
  flowering: <Flower size={24} color="white" />,
  cactus: <TreePine size={24} color="white" />,
  fern: <Droplets size={24} color="white" />,
};

const PlantCard: React.FC<PlantCardProps> = ({ plant }) => {
  const navigate = useNavigate();
  const config = categoryConfig[plant.category];
  const daysOwned = getDaysSince(plant.purchaseDate);
  const isOverYear = daysOwned > 365;

  const handleClick = () => {
    navigate(`/plant/${plant.id}`);
  };

  const getNextReminderDisplay = () => {
    const reminders = [];
    if (plant.nextWateringDate) {
      const isExpired = isDateExpiredOrToday(plant.nextWateringDate);
      reminders.push({
        label: '浇水',
        date: plant.nextWateringDate,
        isExpired,
      });
    }
    if (plant.nextFertilizingDate) {
      const isExpired = isDateExpiredOrToday(plant.nextFertilizingDate);
      reminders.push({
        label: '施肥',
        date: plant.nextFertilizingDate,
        isExpired,
      });
    }
    return reminders;
  };

  const reminders = getNextReminderDisplay();
  const lastWatering = reminders.find(r => r.label === '浇水');
  const nextReminder = reminders.find(r => r.label === '浇水') || reminders[0];

  return (
    <div
      onClick={handleClick}
      style={{
        width: '200px',
        height: '300px',
        backgroundColor: 'var(--color-card)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'all var(--transition-normal)',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: config.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {categoryIcons[plant.category]}
        </div>
        <div style={{ fontSize: '12px' }}>
          {difficultyStars[plant.difficulty]}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <h3 style={{
          fontSize: '18px',
          fontWeight: 600,
          color: 'var(--color-text)',
          marginBottom: '8px',
          textAlign: 'center',
        }}>
          {plant.name}
        </h3>
        <div style={{
          fontSize: '14px',
          color: isOverYear ? 'var(--color-gold)' : 'var(--color-text-light)',
          fontWeight: isOverYear ? 600 : 400,
        }}>
          已养护 {daysOwned} 天
        </div>
        <div style={{
          fontSize: '12px',
          color: 'var(--color-text-light)',
          marginTop: '4px',
        }}>
          {config.label}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {lastWatering && (
          <div style={{
            fontSize: '12px',
            color: 'var(--color-text-light)',
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span>最近浇水:</span>
            <span>{formatDate(lastWatering.date)}</span>
          </div>
        )}
        {nextReminder && (
          <div style={{
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            color: nextReminder.isExpired ? 'var(--color-danger)' : 'var(--color-text-light)',
          }} className={nextReminder.isExpired ? 'animate-pulse-danger' : ''}>
            <span>下次{nextReminder.label}:</span>
            <span>{formatDate(nextReminder.date)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(PlantCard);
