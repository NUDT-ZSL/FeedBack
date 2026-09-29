import React, { useState, useEffect } from 'react';
import { Message } from '../reactor/ReactorEngine';
import { emotionAnalyzer } from '../services/EmotionAnalyzer';

interface SidePanelProps {
  isOpen: boolean;
  message: Message | null;
  allMessages: Message[];
  onClose: () => void;
}

const SidePanel: React.FC<SidePanelProps> = ({
  isOpen,
  message,
  allMessages,
  onClose
}) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const echoMessages = message 
    ? allMessages.filter(m => message.echoIds.includes(m.id))
    : [];

  const panelWidth = isMobile ? '80%' : '20%';

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    width: panelWidth,
    height: '100vh',
    background: 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderLeft: '1px solid rgba(255, 255, 255, 0.3)',
    transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 0.3s ease-out',
    zIndex: 100,
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    color: '#333',
    boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.1)'
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(0, 0, 0, 0.1)'
  };

  const closeBtnStyle: React.CSSProperties = {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0, 0, 0, 0.05)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    transition: 'background 0.2s ease, transform 0.2s ease'
  };

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  };

  const echoItemStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderRadius: '12px',
    background: 'rgba(255, 255, 255, 0.5)',
    border: '1px solid rgba(0, 0, 0, 0.05)',
    fontSize: '13px',
    lineHeight: 1.5,
    color: '#555'
  };

  const sourceCardStyle: React.CSSProperties = message ? {
    padding: '16px',
    borderRadius: '12px',
    background: `linear-gradient(135deg, ${emotionAnalyzer.getEmotionColor(message.emotionType).start}40 0%, ${emotionAnalyzer.getEmotionColor(message.emotionType).end}30 100%)`,
    border: `1px solid ${emotionAnalyzer.getEmotionColor(message.emotionType).end}50`,
    marginBottom: '20px',
    fontSize: '14px',
    color: '#333'
  } : {};

  return (
    <div style={panelStyle} className="scrollbar-thin">
      <div style={headerStyle}>
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#333' }}>
          情绪回响
        </h3>
        <button
          style={closeBtnStyle}
          onClick={onClose}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.9)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
        >
          ✕
        </button>
      </div>

      {message && (
        <div style={sourceCardStyle}>
          <div style={{ fontSize: '20px', marginBottom: '8px' }}>{message.emoji}</div>
          <div style={{ fontWeight: 500, marginBottom: '4px' }}>{message.anonymousName}</div>
          <div style={{ opacity: 0.8 }}>{message.content}</div>
        </div>
      )}

      <div style={{ marginBottom: '12px', fontSize: '13px', color: '#888' }}>
        共 {echoMessages.length} 条回响
      </div>

      <div style={listStyle} className="scrollbar-thin">
        {echoMessages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#aaa', padding: '40px 0', fontSize: '14px' }}>
            暂无回响消息
          </div>
        ) : (
          echoMessages.map((msg) => {
            const colors = emotionAnalyzer.getEmotionColor(msg.emotionType);
            return (
              <div
                key={msg.id}
                style={{
                  ...echoItemStyle,
                  borderLeft: `3px solid ${colors.end}`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '16px' }}>{msg.emoji}</span>
                  <span style={{ fontSize: '12px', color: '#888' }}>{msg.anonymousName}</span>
                </div>
                <div>{msg.content.substring(0, 30)}{msg.content.length > 30 ? '...' : ''}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SidePanel;
