import { useState, useEffect, useRef } from 'react';
import type { BarrageMessage } from './types';

interface BarrageProps {
  eventId: string;
}

interface DanmakuItem extends BarrageMessage {
  top: number;
  animationDuration: number;
  left: string;
}

function Barrage({ eventId }: BarrageProps) {
  const [messages, setMessages] = useState<DanmakuItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messageIdCounter = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const connect = () => {
      if (!mountedRef.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?eventId=${eventId}`;
      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;

      websocket.onopen = () => {
        if (!mountedRef.current) return;
        console.log('弹幕 WebSocket 已连接');
        reconnectAttemptsRef.current = 0;
      };

      websocket.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'barrage') {
            addDanmaku(data.message);
          }
        } catch (error) {
          console.error('解析弹幕消息失败:', error);
        }
      };

      websocket.onclose = () => {
        if (!mountedRef.current) return;
        console.log('弹幕 WebSocket 已断开');
        const attempts = reconnectAttemptsRef.current;
        if (attempts < 10) {
          const delay = Math.min(1000 * Math.pow(2, attempts), 10000);
          console.log(`尝试重连 (${attempts + 1}/10)，延迟 ${delay}ms...`);
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              reconnectAttemptsRef.current++;
              connect();
            }
          }, delay);
        }
      };

      websocket.onerror = (error) => {
        console.error('弹幕 WebSocket 错误:', error);
      };
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [eventId]);

  const getRandomColor = () => {
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7',
      '#fd79a8', '#a29bfe', '#fdcb6e', '#e17055', '#00b894'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const addDanmaku = (message: BarrageMessage) => {
    const isMobile = window.innerWidth < 768;
    const animationDuration = isMobile ? 8 : 12;
    const top = Math.random() * 60 + 10;
    
    const newDanmaku: DanmakuItem = {
      ...message,
      id: `${message.id}-${messageIdCounter.current++}`,
      top,
      animationDuration,
      left: '100%'
    };

    setMessages(prev => [...prev, newDanmaku]);

    setTimeout(() => {
      setMessages(prev => prev.filter(m => m.id !== newDanmaku.id));
    }, animationDuration * 1000);
  };

  const sendMessage = () => {
    if (!inputValue.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (inputValue.length > 20) {
      alert('弹幕内容不能超过20个字');
      return;
    }

    const message: BarrageMessage = {
      id: Date.now().toString(),
      eventId,
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
      color: getRandomColor()
    };

    wsRef.current.send(JSON.stringify({
      type: 'barrage',
      eventId,
      message
    }));

    setInputValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const isMobile = window.innerWidth < 768;

  return (
    <div style={styles.container}>
      <div ref={containerRef} style={styles.barrageArea}>
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              position: 'absolute',
              top: `${msg.top}%`,
              left: msg.left,
              whiteSpace: 'nowrap',
              color: 'white',
              fontSize: isMobile ? '14px' : '18px',
              fontWeight: 'bold',
              textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
              opacity: 0.9,
              animation: `barrageSlide ${msg.animationDuration}s linear forwards`,
              pointerEvents: 'none',
              backgroundColor: `${msg.color}40`,
              padding: '4px 12px',
              borderRadius: '20px',
              border: `1px solid ${msg.color}80`
            }}
          >
            {msg.content}
          </div>
        ))}
      </div>

      <div style={styles.inputArea}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="发送弹幕（20字以内）"
          maxLength={20}
          style={styles.input}
        />
        <button
          onClick={sendMessage}
          disabled={!inputValue.trim()}
          style={{
            ...styles.sendBtn,
            ...(!inputValue.trim() ? styles.sendBtnDisabled : {})
          }}
        >
          发送
        </button>
      </div>

      <style>{`
        @keyframes barrageSlide {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(calc(-100vw - 100%));
          }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden'
  },
  barrageArea: {
    width: '100%',
    height: '80px',
    background: 'rgba(0, 0, 0, 0.3)',
    position: 'relative',
    overflow: 'hidden',
    backdropFilter: 'blur(5px)'
  },
  inputArea: {
    display: 'flex',
    gap: '8px',
    padding: '12px',
    background: 'rgba(255, 255, 255, 0.9)'
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    border: '2px solid #e0e0e0',
    borderRadius: '20px',
    fontSize: '14px',
    outline: 'none'
  },
  sendBtn: {
    padding: '10px 20px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  sendBtnDisabled: {
    background: '#ccc',
    cursor: 'not-allowed'
  }
};

export default Barrage;
