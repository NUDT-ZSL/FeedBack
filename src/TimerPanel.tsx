import React from 'react';
import type { TimerState, TimerControl } from './types';

interface TimerPanelProps {
  state: TimerState;
  control: TimerControl;
  onDurationChange: (minutes: number) => void;
}

const TimerPanel: React.FC<TimerPanelProps> = ({ state, control, onDurationChange }) => {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isLast3Seconds = state.timeLeft <= 3 && state.timeLeft > 0 && state.isRunning;

  const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1 && value <= 999) {
      onDurationChange(value);
    }
  };

  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 60px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '20px',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      minWidth: '400px',
    }}>
      {state.isPaused && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(128, 128, 128, 0.4)',
          borderRadius: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: '24px', fontWeight: 'bold', textShadow: '0 2px 10px rgba(0, 0, 0, 0.5)' }}>已暂停</span>
        </div>
      )}

      <div style={{ marginBottom: '20px', width: '100%' }}>
        <label style={{
          display: 'block',
          marginBottom: '8px',
          fontSize: '14px',
          color: 'rgba(255, 255, 255, 0.7)',
        }}>
          设置时长（分钟）
        </label>
        <input
          type="number"
          min={1}
          max={999}
          step={1}
          value={state.initialTime / 60}
          onChange={handleMinutesChange}
          disabled={state.isRunning || state.isPaused}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '18px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            color: '#ffffff',
            outline: 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
        />
      </div>

      <div
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 'clamp(60px, 15vw, 120px)',
          fontWeight: 'bold',
          letterSpacing: '4px',
          margin: '20px 0',
          color: isLast3Seconds ? '#ff4444' : '#ffffff',
          animation: isLast3Seconds ? 'pulse 0.5s ease-in-out infinite' : 'none',
          textShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatTime(state.timeLeft)}
      </div>

      <div style={{
        display: 'flex',
        gap: '16px',
        marginTop: '20px',
      }}>
        {!state.isRunning && !state.isPaused ? (
          <button
            onClick={control.start}
            style={{
              padding: '14px 40px',
              fontSize: '18px',
              fontWeight: 'bold',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#4CAF50',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.2s',
              boxShadow: '0 4px 15px rgba(76, 175, 80, 0.4)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(76, 175, 80, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(76, 175, 80, 0.4)';
            }}
          >
            开始
          </button>
        ) : state.isRunning ? (
          <button
            onClick={control.pause}
            style={{
              padding: '14px 40px',
              fontSize: '18px',
              fontWeight: 'bold',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#ff9800',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              boxShadow: '0 4px 15px rgba(255, 152, 0, 0.4)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(255, 152, 0, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(255, 152, 0, 0.4)';
            }}
          >
            暂停
          </button>
        ) : (
          <button
            onClick={control.start}
            style={{
              padding: '14px 40px',
              fontSize: '18px',
              fontWeight: 'bold',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#2196F3',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              boxShadow: '0 4px 15px rgba(33, 150, 243, 0.4)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(33, 150, 243, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(33, 150, 243, 0.4)';
            }}
          >
            继续
          </button>
        )}

        <button
          onClick={control.reset}
          style={{
            padding: '14px 40px',
            fontSize: '18px',
            fontWeight: 'bold',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: '#f44336',
            color: '#ffffff',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
            boxShadow: '0 4px 15px rgba(244, 67, 54, 0.4)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(244, 67, 54, 0.6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 4px 15px rgba(244, 67, 54, 0.4)';
          }}
        >
          重置
        </button>
      </div>
    </div>
  );
};

export default TimerPanel;
