import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Droplets, Leaf, AlertTriangle } from 'lucide-react';
import type { Reminder } from '../types';
import { formatDate } from '../utils';

interface ReminderPageProps {
  fetchTodayReminders: () => Promise<Reminder[]>;
}

const ReminderPage: React.FC<ReminderPageProps> = ({ fetchTodayReminders }) => {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const loadReminders = async () => {
      setLoading(true);
      const data = await fetchTodayReminders();
      setReminders(data);
      setLoading(false);
    };
    loadReminders();
  }, [fetchTodayReminders]);

  const getTypeLabel = (type: 'water' | 'fertilize') => {
    return type === 'water' ? '浇水' : '施肥';
  };

  const getTypeIcon = (type: 'water' | 'fertilize') => {
    return type === 'water' ? <Droplets size={20} /> : <Leaf size={20} />;
  };

  const getTypeColor = (type: 'water' | 'fertilize') => {
    return type === 'water' ? '#4FC3F7' : '#FFB74D';
  };

  return (
    <div
      className="animate-fade-in"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        padding: '24px',
        maxWidth: '800px',
        margin: '0 auto',
      }}
    >
      <button
        onClick={() => navigate('/')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          border: 'none',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--color-primary)',
          color: 'white',
          cursor: 'pointer',
          fontSize: '14px',
          marginBottom: '24px',
          transition: 'all var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#45a049';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-primary)';
        }}
      >
        <ArrowLeft size={18} />
        返回首页
      </button>

      <h1 style={{
        fontSize: '28px',
        fontWeight: 700,
        color: 'var(--color-text)',
        marginBottom: '8px',
      }}>
        🔔 今日待办
      </h1>
      <p style={{
        fontSize: '14px',
        color: 'var(--color-text-light)',
        marginBottom: '24px',
      }}>
        {reminders.length} 棵植物需要照顾
      </p>

      {loading ? (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '200px',
          fontSize: '16px',
          color: 'var(--color-text-light)',
        }}>
          加载中...
        </div>
      ) : reminders.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          backgroundColor: 'var(--color-card)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>
            ✅
          </div>
          <h2 style={{
            fontSize: '20px',
            color: 'var(--color-text)',
            marginBottom: '8px',
          }}>
            太棒了！
          </h2>
          <p style={{
            fontSize: '14px',
            color: 'var(--color-text-light)',
          }}>
            今天没有需要照顾的植物
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {reminders.map((reminder, index) => {
            const isOverdue3Days = reminder.daysOverdue > 3;
            return (
              <div
                key={`${reminder.plantId}-${reminder.type}-${index}`}
                onClick={() => navigate(`/plant/${reminder.plantId}`)}
                style={{
                  backgroundColor: 'var(--color-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '20px',
                  boxShadow: 'var(--shadow-sm)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-normal)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  borderLeft: isOverdue3Days ? '6px solid var(--color-danger)' : '4px solid transparent',
                  animation: `slide-up 0.3s ease-out ${index * 0.05}s both`,
                }}
                className={isOverdue3Days ? 'animate-border-flicker' : ''}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                  e.currentTarget.style.transform = 'translateX(4px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: getTypeColor(reminder.type) + '20',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: getTypeColor(reminder.type),
                    flexShrink: 0,
                  }}
                >
                  {getTypeIcon(reminder.type)}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}>
                    <h3 style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      color: 'var(--color-text)',
                    }}>
                      {reminder.plantName}
                    </h3>
                    {reminder.daysOverdue > 0 && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        color: 'var(--color-danger)',
                        fontWeight: 600,
                      }}>
                        <AlertTriangle size={14} />
                        过期 {reminder.daysOverdue} 天
                      </div>
                    )}
                    {reminder.daysOverdue === 0 && (
                      <div style={{
                        fontSize: '12px',
                        color: 'var(--color-secondary)',
                        fontWeight: 600,
                      }}>
                        今天
                      </div>
                    )}
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    fontSize: '13px',
                    color: 'var(--color-text-light)',
                  }}>
                    <span style={{ color: getTypeColor(reminder.type) }}>
                      {getTypeLabel(reminder.type)}
                    </span>
                    <span>原定日期: {formatDate(reminder.dueDate)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReminderPage;
