import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Message } from '../reactor/ReactorEngine';
import MessageCard from './MessageCard';

interface EmotionCorridorProps {
  messages: Message[];
  onEchoClick: (messageId: string) => void;
  onSendMessage: (content: string) => void;
  newMessageId?: string | null;
}

interface Particle {
  id: number;
  x: number;
  color: string;
  startTime: number;
}

const CARD_HEIGHT = 120;
const CARD_GAP = 16;
const BUFFER_SIZE = 10;
const TIME_WINDOW_MS = 60 * 1000;
const VIRTUAL_THRESHOLD = 50;

const EmotionCorridor: React.FC<EmotionCorridorProps> = ({
  messages,
  onEchoClick,
  onSendMessage,
  newMessageId
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollHeight, setScrollHeight] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const particleIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateHeight = () => {
      if (scrollContainerRef.current) {
        setScrollHeight(scrollContainerRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const totalHeight = useMemo(() => {
    return messages.length * (CARD_HEIGHT + CARD_GAP);
  }, [messages.length]);

  const useVirtualScroll = messages.length > VIRTUAL_THRESHOLD && scrollHeight > 0;

  const visibleRange = useMemo(() => {
    if (!useVirtualScroll) {
      return { startIndex: 0, endIndex: messages.length - 1 };
    }
    const startIndex = Math.max(0, Math.floor(scrollTop / (CARD_HEIGHT + CARD_GAP)) - BUFFER_SIZE);
    const endIndex = Math.min(
      messages.length - 1,
      Math.ceil((scrollTop + scrollHeight) / (CARD_HEIGHT + CARD_GAP)) + BUFFER_SIZE
    );
    return { startIndex, endIndex };
  }, [scrollTop, scrollHeight, messages.length, useVirtualScroll]);

  const visibleMessages = useMemo(() => {
    if (!useVirtualScroll) {
      return messages;
    }
    return messages.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
  }, [messages, visibleRange.startIndex, visibleRange.endIndex, useVirtualScroll]);

  const shouldShowLine = useCallback((index: number): boolean => {
    if (index >= messages.length - 1) return false;
    const current = messages[index];
    const next = messages[index + 1];
    const timeDiff = Math.abs(next.timestamp - current.timestamp);
    return timeDiff <= TIME_WINDOW_MS && current.emotionType === next.emotionType;
  }, [messages]);

  const getLineWidth = useCallback((index: number): number => {
    if (index >= messages.length - 1) return 1;
    const current = messages[index];
    const next = messages[index + 1];
    const avgIntensity = (current.intensity + next.intensity) / 2;
    return Math.max(1, Math.min(5, avgIntensity));
  }, [messages]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    
    onSendMessage(inputValue.trim());
    setInputValue('');
    
    const colors = {
      positive: '#FFE082',
      negative: '#BBDEFB',
      neutral: '#E0E0E0'
    };
    const newParticles: Particle[] = [];
    for (let i = 0; i < 8; i++) {
      newParticles.push({
        id: particleIdRef.current++,
        x: 40 + Math.random() * 20,
        color: colors.neutral,
        startTime: Date.now() + i * 30
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
    
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !newParticles.find(np => np.id === p.id)));
    }, 800);
  }, [inputValue, onSendMessage]);

  useEffect(() => {
    if (newMessageId && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [newMessageId]);

  const corridorStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column'
  };

  const scrollContainerStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '20px 40px 100px',
    position: 'relative'
  };

  const inputContainerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '20px 40px',
    background: 'linear-gradient(to top, rgba(26, 26, 46, 0.95) 0%, rgba(26, 26, 46, 0.8) 70%, transparent 100%)',
    transform: isInputFocused ? 'translateY(0)' : 'translateY(10px)',
    opacity: isInputFocused ? 1 : 0.9,
    transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
    zIndex: 10
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '16px 24px',
    borderRadius: '28px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
    boxShadow: isInputFocused ? '0 0 20px rgba(255, 255, 255, 0.1)' : 'none'
  };

  const particlesContainerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '80px',
    left: 0,
    right: 0,
    height: '200px',
    pointerEvents: 'none',
    overflow: 'hidden'
  };

  return (
    <div style={corridorStyle}>
      <div 
        style={scrollContainerStyle} 
        onScroll={handleScroll}
        ref={scrollContainerRef}
        className="scrollbar-thin"
      >
        {useVirtualScroll ? (
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visibleMessages.map((message, idx) => {
              const actualIndex = visibleRange.startIndex + idx;
              const top = actualIndex * (CARD_HEIGHT + CARD_GAP);
              
              return (
                <div
                  key={message.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${top}px)`,
                    transition: 'transform 0.2s ease'
                  }}
                >
                  <MessageCard
                    message={message}
                    isNew={message.id === newMessageId}
                    showLine={shouldShowLine(actualIndex)}
                    lineWidth={getLineWidth(actualIndex)}
                    onEchoClick={onEchoClick}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visibleMessages.map((message, idx) => (
              <MessageCard
                key={message.id}
                message={message}
                isNew={message.id === newMessageId}
                showLine={shouldShowLine(idx)}
                lineWidth={getLineWidth(idx)}
                onEchoClick={onEchoClick}
              />
            ))}
          </div>
        )}

        {messages.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '60vh',
            color: 'rgba(255, 255, 255, 0.4)',
            textAlign: 'center',
            gap: '12px'
          }}>
            <div style={{ fontSize: '48px' }}>🌙</div>
            <div style={{ fontSize: '16px' }}>走廊很安静...</div>
            <div style={{ fontSize: '13px' }}>成为第一个分享情绪的人吧</div>
          </div>
        )}
      </div>

      <div style={particlesContainerStyle}>
        {particles.map(particle => (
          <div
            key={particle.id}
            style={{
              position: 'absolute',
              bottom: 0,
              left: `${particle.x}%`,
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: particle.color,
              boxShadow: `0 0 10px ${particle.color}`,
              animation: 'particleFloat 0.8s ease-out forwards',
              animationDelay: `${Math.max(0, (particle.startTime - Date.now()) / 1000)}s`
            }}
          />
        ))}
      </div>

      <div style={inputContainerStyle}>
        <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            placeholder={isInputFocused ? '你的情绪会飘向走廊深处...' : '写下此刻感受...'}
            style={inputStyle}
          />
          <button
            type="submit"
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s ease, transform 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
              e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
              e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(-50%) scale(0.95)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)';
            }}
          >
            ➤
          </button>
        </form>
      </div>
    </div>
  );
};

export default EmotionCorridor;
