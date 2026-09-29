import React, { useState, useEffect, useRef } from 'react';
import { Message } from '../reactor/ReactorEngine';
import { emotionAnalyzer } from '../services/EmotionAnalyzer';

interface MessageCardProps {
  message: Message;
  isNew?: boolean;
  showLine?: boolean;
  lineWidth?: number;
  onEchoClick: (messageId: string) => void;
}

const MessageCard: React.FC<MessageCardProps> = ({
  message,
  isNew = false,
  showLine = false,
  lineWidth = 1,
  onEchoClick
}) => {
  const [isExpanded, setIsExpanded] = useState(!isNew);
  const [echoBounce, setEchoBounce] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const prevEchoCount = useRef(message.echoCount);

  const colors = emotionAnalyzer.getEmotionColor(message.emotionType);

  useEffect(() => {
    if (isNew) {
      const timer = setTimeout(() => setIsExpanded(true), 50);
      return () => clearTimeout(timer);
    }
  }, [isNew]);

  useEffect(() => {
    if (message.echoCount !== prevEchoCount.current) {
      setEchoBounce(true);
      const timer = setTimeout(() => setEchoBounce(false), 200);
      prevEchoCount.current = message.echoCount;
      return () => clearTimeout(timer);
    }
  }, [message.echoCount]);

  const cardStyle: React.CSSProperties = {
    position: 'relative',
    padding: '16px 20px',
    borderRadius: '16px',
    marginBottom: showLine ? '24px' : '16px',
    background: `linear-gradient(135deg, ${colors.start}30 0%, ${colors.end}20 100%)`,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${colors.end}40`,
    color: '#e0e0e0',
    cursor: 'pointer',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease, opacity 0.4s ease-out',
    transform: isHovered ? 'scale(1.03)' : 'scale(1)',
    filter: isHovered ? 'brightness(1.1)' : 'brightness(1)',
    boxShadow: isHovered 
      ? `0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px ${colors.start}30`
      : '0 4px 16px rgba(0, 0, 0, 0.2)',
    opacity: isExpanded ? 1 : 0,
    overflow: 'hidden',
    transformOrigin: 'center'
  };

  const tagStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderRadius: '20px',
    background: 'rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    fontSize: '12px',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: '10px',
    transition: 'transform 0.2s ease, filter 0.2s ease',
    transform: isHovered ? 'scale(1.05)' : 'scale(1)',
    filter: isHovered ? 'blur(0px)' : 'blur(0px)'
  };

  const echoBadgeStyle: React.CSSProperties = {
    position: 'absolute',
    right: '16px',
    top: '50%',
    transform: `translateY(-50%) scale(${echoBounce ? 1.2 : 1})`,
    transition: 'transform 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '20px',
    background: `${colors.start}20`,
    border: `1px solid ${colors.end}40`,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500
  };

  const lineStyle: React.CSSProperties = showLine ? {
    position: 'absolute',
    left: '50%',
    top: '100%',
    transform: 'translateX(-50%)',
    width: `${lineWidth}px`,
    height: '24px',
    background: '#888',
    animation: 'lineBlink 2s ease-in-out infinite',
    opacity: 0.6,
    borderRadius: '1px'
  } : {};

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  const handleEchoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEchoClick(message.id);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={cardStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleEchoClick}
      >
        <div style={tagStyle}>
          <span>{message.anonymousName}</span>
        </div>
        
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>
          {message.emoji}
        </div>
        
        <div style={{ 
          fontSize: '15px', 
          lineHeight: 1.6,
          color: 'rgba(255, 255, 255, 0.9)',
          paddingRight: '80px'
        }}>
          {message.content}
        </div>

        {showLine && <div style={lineStyle} />}

        <div style={echoBadgeStyle} onClick={handleEchoClick}>
          <span>📢</span>
          <span>{message.echoCount}</span>
        </div>
      </div>
    </div>
  );
};

export default MessageCard;
