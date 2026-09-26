import { useState } from 'react';
import { TIMEZONE_OPTIONS } from '../utils/timezone';
import EventModal from './EventModal';
import type { TeamMember } from '../types';

interface HeaderProps {
  currentTimezone: string;
  onTimezoneChange: (timezone: string) => void;
  onAddEvent: (data: {
    title: string;
    startMinutes: number;
    durationMinutes: number;
    memberIds: string[];
  }) => void;
  members: TeamMember[];
  onToggleSidebar: () => void;
}

export default function Header({
  currentTimezone,
  onTimezoneChange,
  onAddEvent,
  members,
  onToggleSidebar,
}: HeaderProps) {
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);

  return (
    <>
      <header
        style={{
          height: '64px',
          backgroundColor: '#0D1117',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          gap: '16px',
          flexShrink: 0,
          borderBottom: '1px solid #21262D',
        }}
      >
        <button
          className="menu-toggle"
          onClick={onToggleSidebar}
          style={{
            display: 'none',
            width: '32px',
            height: '32px',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: 0,
          }}
        >
          <span
            style={{
              width: '20px',
              height: '2px',
              backgroundColor: '#FFFFFF',
              borderRadius: '1px',
            }}
          />
          <span
            style={{
              width: '20px',
              height: '2px',
              backgroundColor: '#FFFFFF',
              borderRadius: '1px',
            }}
          />
          <span
            style={{
              width: '20px',
              height: '2px',
              backgroundColor: '#FFFFFF',
              borderRadius: '1px',
            }}
          />
        </button>

        <h1
          style={{
            fontSize: '24px',
            color: '#FFFFFF',
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.5px',
          }}
        >
          时区桥梁
        </h1>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <label
              style={{
                color: '#8B949E',
                fontSize: '13px',
              }}
            >
              基准时区:
            </label>
            <select
              value={currentTimezone}
              onChange={(e) => onTimezoneChange(e.target.value)}
              style={{
                padding: '8px 12px',
                backgroundColor: '#161B22',
                border: '1px solid #30363D',
                borderRadius: '6px',
                color: '#FFFFFF',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer',
                transition: 'border-color 150ms ease',
              }}
              onFocus={(e) =>
                (e.currentTarget.style.borderColor = '#6366F1')
              }
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = '#30363D')
              }
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsEventModalOpen(true)}
            disabled={members.length === 0}
            style={{
              padding: '10px 18px',
              backgroundColor: '#6366F1',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 500,
              cursor: members.length === 0 ? 'not-allowed' : 'pointer',
              opacity: members.length === 0 ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (members.length > 0) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  '#4F46E5';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#6366F1';
            }}
          >
            <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
            添加事件
          </button>
        </div>
      </header>

      <EventModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        onSubmit={onAddEvent}
        members={members}
        baseTimezone={currentTimezone}
      />
    </>
  );
}
