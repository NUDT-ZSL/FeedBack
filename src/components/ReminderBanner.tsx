import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import type { Reminder } from '../types';

interface ReminderBannerProps {
  fetchReminders: () => Promise<Reminder[]>;
}

const ReminderBanner: React.FC<ReminderBannerProps> = ({ fetchReminders }) => {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();

  const loadReminders = useCallback(async () => {
    const data = await fetchReminders();
    setReminders(data);
    setVisible(data.length > 0);
  }, [fetchReminders]);

  useEffect(() => {
    loadReminders();
    const interval = setInterval(loadReminders, 60000);
    return () => clearInterval(interval);
  }, [loadReminders]);

  if (!visible || reminders.length === 0) return null;

  const handleClick = () => {
    navigate('/reminders');
  };

  return (
    <div
      onClick={handleClick}
      className="animate-slide-down"
      style={{
        background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
        padding: '12px 24px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        boxShadow: 'var(--shadow-md)',
        transition: 'all var(--transition-fast)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '0.9';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
    >
      <Bell size={20} color="white" />
      <span style={{
        color: 'white',
        fontWeight: 600,
        fontSize: '14px',
      }}>
        今天有 {reminders.length} 棵植物需要照顾，点击查看
      </span>
    </div>
  );
};

export default ReminderBanner;
