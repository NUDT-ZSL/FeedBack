import { useState } from 'react';
import { TIMEZONE_OPTIONS, parseTime, formatTime } from '../utils/timezone';
import type { TeamMember } from '../types';

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    startMinutes: number;
    durationMinutes: number;
    memberIds: string[];
  }) => void;
  members: TeamMember[];
  baseTimezone: string;
}

const DURATION_OPTIONS = [30, 60, 90, 120];

function generateTimeOptions(): string[] {
  const times: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      times.push(formatTime(h * 60 + m));
    }
  }
  return times;
}

export default function EventModal({
  isOpen,
  onClose,
  onSubmit,
  members,
  baseTimezone,
}: EventModalProps) {
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [duration, setDuration] = useState(60);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    members.map((m) => m.id)
  );

  if (!isOpen) return null;

  const timezoneLabel =
    TIMEZONE_OPTIONS.find((tz) => tz.value === baseTimezone)?.label ||
    baseTimezone;

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || selectedMembers.length === 0) return;
    onSubmit({
      title: title.trim(),
      startMinutes: parseTime(startTime),
      durationMinutes: duration,
      memberIds: selectedMembers,
    });
    setTitle('');
    setStartTime('09:00');
    setDuration(60);
    setSelectedMembers(members.map((m) => m.id));
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#1E1E2E',
          borderRadius: '12px',
          padding: '24px',
          width: '400px',
          maxWidth: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <h3
          style={{
            color: '#FFFFFF',
            fontSize: '18px',
            fontWeight: 600,
            margin: 0,
            marginBottom: '20px',
          }}
        >
          创建新事件
        </h3>

        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'block',
              color: '#8B949E',
              fontSize: '12px',
              marginBottom: '6px',
            }}
          >
            事件标题
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入事件名称"
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#161B22',
              border: '1px solid #30363D',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = '#6366F1')
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = '#30363D')
            }
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: 'block',
                color: '#8B949E',
                fontSize: '12px',
                marginBottom: '6px',
              }}
            >
              起始时间 ({timezoneLabel})
            </label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#161B22',
                border: '1px solid #30363D',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '14px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {generateTimeOptions().map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1 }}>
            <label
              style={{
                display: 'block',
                color: '#8B949E',
                fontSize: '12px',
                marginBottom: '6px',
              }}
            >
              持续时间
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#161B22',
                border: '1px solid #30363D',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '14px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} 分钟
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label
            style={{
              display: 'block',
              color: '#8B949E',
              fontSize: '12px',
              marginBottom: '8px',
            }}
          >
            参与成员
          </label>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            {members.map((member) => {
              const isSelected = selectedMembers.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleMember(member.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    backgroundColor: isSelected
                      ? member.avatarColor
                      : '#161B22',
                    border: isSelected
                      ? `1px solid ${member.avatarColor}`
                      : '1px solid #30363D',
                    borderRadius: '20px',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                >
                  <span
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      backgroundColor: isSelected
                        ? 'rgba(255,255,255,0.2)'
                        : member.avatarColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 600,
                    }}
                  >
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                  {member.name}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: 'transparent',
              border: '1px solid #30363D',
              borderRadius: '6px',
              color: '#8B949E',
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#FFFFFF';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                '#8B949E';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#8B949E';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                '#30363D';
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!title.trim() || selectedMembers.length === 0}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6366F1',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 500,
              cursor:
                !title.trim() || selectedMembers.length === 0
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                !title.trim() || selectedMembers.length === 0 ? 0.5 : 1,
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (title.trim() && selectedMembers.length > 0) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  '#4F46E5';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#6366F1';
            }}
          >
            创建事件
          </button>
        </div>
      </form>
    </div>
  );
}
