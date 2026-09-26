import { useState } from 'react';
import { TIMEZONE_OPTIONS } from '../utils/timezone';

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; timezone: string }) => void;
}

export default function MemberModal({
  isOpen,
  onClose,
  onSubmit,
}: MemberModalProps) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC+8');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), timezone });
    setName('');
    setTimezone('UTC+8');
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
          width: '360px',
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
          添加团队成员
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
            成员姓名
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入成员姓名"
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
            onFocus={(e) => (e.currentTarget.style.borderColor = '#6366F1')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#30363D')}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label
            style={{
              display: 'block',
              color: '#8B949E',
              fontSize: '12px',
              marginBottom: '6px',
            }}
          >
            所在时区
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
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
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
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
            disabled={!name.trim()}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6366F1',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 500,
              cursor: !name.trim() ? 'not-allowed' : 'pointer',
              opacity: !name.trim() ? 0.5 : 1,
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (name.trim()) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  '#4F46E5';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                '#6366F1';
            }}
          >
            添加成员
          </button>
        </div>
      </form>
    </div>
  );
}
