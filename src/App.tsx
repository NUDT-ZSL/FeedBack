import React, { useState, useEffect, useReducer, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Toaster, toast } from 'react-hot-toast';
import EmotionCorridor from './modules/ui/EmotionCorridor';
import SidePanel from './modules/ui/SidePanel';
import { Message, reactorEngine } from './modules/reactor/ReactorEngine';
import { emotionAnalyzer } from './modules/services/EmotionAnalyzer';

interface AppState {
  messages: Message[];
  selectedMessageId: string | null;
  isSidePanelOpen: boolean;
  overallEmotionIndex: number;
  stats: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

type AppAction =
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'UPDATE_MESSAGES'; payload: Message[] }
  | { type: 'SELECT_MESSAGE'; payload: string | null }
  | { type: 'TOGGLE_SIDE_PANEL'; payload: boolean }
  | { type: 'SET_EMOTION_INDEX'; payload: number }
  | { type: 'SET_STATS'; payload: { positive: number; negative: number; neutral: number } };

const adjectives = [
  '柠檬', '深空', '月光', '星尘', '微风', '清晨', '黄昏', '霓虹', '迷雾', '森林',
  '海洋', '极光', '银河', '琥珀', '翡翠', '蔷薇', '薰衣草', '棉花糖', '焦糖', '抹茶',
  '蜜桃', '蓝莓', '椰子', '芒果', '草莓', '葡萄', '西瓜', '橙子', '苹果', '樱桃'
];

const nouns = [
  '鱼', '旅人', '猫', '鹿', '狐', '鲸', '蝶', '鸟', '云', '风',
  '叶', '花', '星', '月', '雨', '雪', '冰', '火', '光', '影',
  '骑士', '诗人', '画家', '音乐家', '探险家', '梦想家', '守望者', '漫游者', '拾荒者', '守夜人'
];

function generateAnonymousName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}${noun}${num}`;
}

function extractEmoji(text: string): string {
  const emojiMatch = text.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
  if (emojiMatch && emojiMatch.length > 0) {
    return emojiMatch[0];
  }
  return '💭';
}

function generateMockMessages(): Message[] {
  const mockContents = [
    { text: '😌今天阳光很好，心情也跟着亮堂起来了', type: 'positive' as const },
    { text: '😊喝了一杯好喝的咖啡，满足~', type: 'positive' as const },
    { text: '🥰收到了朋友的礼物，好开心', type: 'positive' as const },
    { text: '😔工作压力好大，有点喘不过气', type: 'negative' as const },
    { text: '😢今天下雨了，心情也灰蒙蒙的', type: 'negative' as const },
    { text: '😐今天平平淡淡，没什么特别的', type: 'neutral' as const },
    { text: '😌终于把事情做完了，可以休息了', type: 'positive' as const },
    { text: '😤刚才遇到了很无语的事情', type: 'negative' as const },
    { text: '🌸路边的花开了，好好看', type: 'positive' as const },
    { text: '😴好困啊，想睡觉', type: 'neutral' as const },
    { text: '🎉项目终于上线了！', type: 'positive' as const },
    { text: '😞感觉最近有点迷茫', type: 'negative' as const },
    { text: '✨今天的晚霞真的太美了', type: 'positive' as const },
    { text: '😩又加班，好累', type: 'negative' as const },
    { text: '🌙晚安，世界', type: 'neutral' as const }
  ];

  const now = Date.now();
  return mockContents.map((item, index) => {
    const analysis = emotionAnalyzer.analyze(item.text);
    return {
      id: uuidv4(),
      content: item.text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim(),
      emoji: extractEmoji(item.text),
      emotionType: analysis.emotionType,
      intensity: analysis.intensity,
      timestamp: now - (mockContents.length - index) * 30000 - Math.random() * 20000,
      anonymousName: generateAnonymousName(),
      echoCount: Math.floor(Math.random() * 3),
      echoIds: []
    };
  });
}

const initialState: AppState = {
  messages: [],
  selectedMessageId: null,
  isSidePanelOpen: false,
  overallEmotionIndex: 50,
  stats: { positive: 33, negative: 33, neutral: 34 }
};

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'UPDATE_MESSAGES':
      return { ...state, messages: action.payload };
    case 'SELECT_MESSAGE':
      return { ...state, selectedMessageId: action.payload };
    case 'TOGGLE_SIDE_PANEL':
      return { ...state, isSidePanelOpen: action.payload };
    case 'SET_EMOTION_INDEX':
      return { ...state, overallEmotionIndex: action.payload };
    case 'SET_STATS':
      return { ...state, stats: action.payload };
    default:
      return state;
  }
}

const App: React.FC = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [newMessageId, setNewMessageId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showLeftDrawer, setShowLeftDrawer] = useState(false);
  const [indexFlash, setIndexFlash] = useState(false);
  const [anonymousName, setAnonymousName] = useState('');
  const prevIndexRef = useRef(state.overallEmotionIndex);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    let name = localStorage.getItem('emotion_corridor_name');
    if (!name) {
      name = generateAnonymousName();
      localStorage.setItem('emotion_corridor_name', name);
    }
    setAnonymousName(name);
    
    const mockMessages = generateMockMessages();
    let updatedMessages: Message[] = [];
    
    for (let i = 0; i < mockMessages.length; i++) {
      const result = reactorEngine.analyzeAndMatch(mockMessages[i], updatedMessages);
      updatedMessages = result.updatedMessages;
    }
    
    dispatch({ type: 'UPDATE_MESSAGES', payload: updatedMessages });
    
    const index = reactorEngine.calculateOverallEmotionIndex(updatedMessages);
    dispatch({ type: 'SET_EMOTION_INDEX', payload: index });
    
    const stats = reactorEngine.calculateEmotionStats(updatedMessages);
    dispatch({ type: 'SET_STATS', payload: stats });
  }, []);

  useEffect(() => {
    if (state.overallEmotionIndex !== prevIndexRef.current) {
      setIndexFlash(true);
      const timer = setTimeout(() => setIndexFlash(false), 300);
      prevIndexRef.current = state.overallEmotionIndex;
      return () => clearTimeout(timer);
    }
  }, [state.overallEmotionIndex]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (state.messages.length > 0) {
        const index = reactorEngine.calculateOverallEmotionIndex(state.messages);
        dispatch({ type: 'SET_EMOTION_INDEX', payload: index });
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [state.messages]);

  const handleSendMessage = useCallback((content: string) => {
    const analysis = emotionAnalyzer.analyze(content);
    const emoji = extractEmoji(content);
    const cleanContent = content.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

    const newMessage: Message = {
      id: uuidv4(),
      content: cleanContent,
      emoji,
      emotionType: analysis.emotionType,
      intensity: analysis.intensity,
      timestamp: Date.now(),
      anonymousName,
      echoCount: 0,
      echoIds: []
    };

    const result = reactorEngine.analyzeAndMatch(newMessage, state.messages);
    dispatch({ type: 'UPDATE_MESSAGES', payload: result.updatedMessages });
    
    const stats = reactorEngine.calculateEmotionStats(result.updatedMessages);
    dispatch({ type: 'SET_STATS', payload: stats });
    
    const index = reactorEngine.calculateOverallEmotionIndex(result.updatedMessages);
    dispatch({ type: 'SET_EMOTION_INDEX', payload: index });

    setNewMessageId(newMessage.id);
    setTimeout(() => setNewMessageId(null), 1000);

    if (result.matchedIds.length > 0) {
      toast.success(`你的情绪找到了 ${result.matchedIds.length} 个回响！`, {
        duration: 2000,
        style: {
          background: 'rgba(255, 255, 255, 0.9)',
          color: '#333',
          borderRadius: '12px',
          backdropFilter: 'blur(10px)'
        }
      });
    }
  }, [state.messages, anonymousName]);

  const handleEchoClick = useCallback((messageId: string) => {
    dispatch({ type: 'SELECT_MESSAGE', payload: messageId });
    dispatch({ type: 'TOGGLE_SIDE_PANEL', payload: true });
  }, []);

  const handleCloseSidePanel = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDE_PANEL', payload: false });
  }, []);

  const selectedMessage = state.messages.find(m => m.id === state.selectedMessageId) || null;

  const getThermometerColor = (value: number) => {
    if (value < 25) return '#1A237E';
    if (value < 40) return '#1565C0';
    if (value < 50) return '#2E7D32';
    if (value === 50) return '#8BC34A';
    if (value < 60) return '#FDD835';
    if (value < 75) return '#FF8F00';
    return '#B71C1C';
  };

  const ArcProgress: React.FC<{
    value: number;
    colorStart: string;
    colorEnd: string;
    label: string;
  }> = ({ value, colorStart, colorEnd, label }) => {
    const radius = 40;
    const strokeWidth = 6;
    const circumference = Math.PI * radius;
    const offset = circumference - (value / 100) * circumference;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div style={{ position: 'relative', width: `${radius * 2}px`, height: `${radius}px` }}>
          <svg width={radius * 2} height={radius}>
            <defs>
              <linearGradient id={`grad-${label}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={colorStart} />
                <stop offset="100%" stopColor={colorEnd} />
              </linearGradient>
            </defs>
            <circle
              cx={radius}
              cy={radius}
              r={radius - strokeWidth / 2}
              fill="none"
              stroke="rgba(255, 255, 255, 0.1)"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={0}
              strokeLinecap="round"
              transform={`rotate(180 ${radius} ${radius})`}
            />
            <circle
              cx={radius}
              cy={radius}
              r={radius - strokeWidth / 2}
              fill="none"
              stroke={`url(#grad-${label})`}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(180 ${radius} ${radius})`}
              style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: '16px',
              fontWeight: 600,
              color: '#fff'
            }}
          >
            {value}%
          </div>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: `radial-gradient(circle, ${colorEnd}20 0%, transparent 70%)`,
              animation: 'ripple 3s ease-in-out infinite',
              pointerEvents: 'none'
            }}
          />
        </div>
        <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>{label}</span>
      </div>
    );
  };

  const leftPanelStyle: React.CSSProperties = {
    width: '20%',
    height: '100vh',
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    background: 'rgba(255, 255, 255, 0.02)',
    borderRight: '1px solid rgba(255, 255, 255, 0.05)'
  };

  const centerPanelStyle: React.CSSProperties = {
    flex: 1,
    height: '100vh',
    position: 'relative',
    overflow: 'hidden'
  };

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      display: 'flex',
      overflow: 'hidden',
      position: 'relative'
    }}>
      <Toaster position="top-center" />

      {!isMobile && (
        <div style={leftPanelStyle}>
          <div>
            <h2 style={{
              fontSize: '14px',
              fontWeight: 500,
              color: 'rgba(255, 255, 255, 0.6)',
              marginBottom: '16px',
              textAlign: 'center'
            }}>
              情绪温度计
            </h2>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                position: 'relative',
                width: '24px',
                height: '180px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                overflow: 'hidden'
              }}>
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: `linear-gradient(to top, ${getThermometerColor(0)}, ${getThermometerColor(state.overallEmotionIndex)})`,
                    height: `${state.overallEmotionIndex}%`,
                    transition: 'height 0.8s ease-in-out, background 0.8s ease-in-out',
                    animation: indexFlash ? 'mercuryGlow 0.3s ease' : undefined,
                    boxShadow: `0 0 20px ${getThermometerColor(state.overallEmotionIndex)}40`
                  }}
                />
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: '10px',
                  color: 'rgba(255, 255, 255, 0.5)',
                  padding: '4px 0'
                }}>100</div>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: '10px',
                  color: 'rgba(255, 255, 255, 0.5)',
                  padding: '4px 0'
                }}>0</div>
              </div>
              <div style={{
                fontSize: '24px',
                fontWeight: 700,
                color: '#fff',
                opacity: indexFlash ? 1 : 0.9,
                transition: 'opacity 0.3s ease',
                textShadow: `0 0 20px ${getThermometerColor(state.overallEmotionIndex)}60`
              }}>
                {Math.round(state.overallEmotionIndex)}
              </div>
              <div style={{
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.4)'
              }}>
                整体情绪指数
              </div>
            </div>
          </div>

          <div>
            <h2 style={{
              fontSize: '14px',
              fontWeight: 500,
              color: 'rgba(255, 255, 255, 0.6)',
              marginBottom: '20px',
              textAlign: 'center'
            }}>
              情绪分布
            </h2>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              alignItems: 'center'
            }}>
              <ArcProgress
                value={state.stats.positive}
                colorStart="#CDDC39"
                colorEnd="#8BC34A"
                label="正面"
              />
              <ArcProgress
                value={state.stats.negative}
                colorStart="#FF7043"
                colorEnd="#E53935"
                label="负面"
              />
              <ArcProgress
                value={state.stats.neutral}
                colorStart="#90A4AE"
                colorEnd="#607D8B"
                label="中性"
              />
            </div>
          </div>

          <div style={{ marginTop: 'auto' }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>你的代号</div>
              <div style={{ fontSize: '14px', color: '#fff', fontWeight: 500 }}>{anonymousName}</div>
            </div>
          </div>
        </div>
      )}

      {isMobile && showLeftDrawer && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '80%',
            height: '100vh',
            background: 'rgba(26, 26, 46, 0.95)',
            backdropFilter: 'blur(20px)',
            zIndex: 200,
            padding: '24px 20px',
            animation: 'fadeIn 0.3s ease'
          }}
        >
          <button
            onClick={() => setShowLeftDrawer(false)}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: '24px',
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={centerPanelStyle}>
        {isMobile && (
          <>
            <button
              onClick={() => setShowLeftDrawer(true)}
              style={{
                position: 'fixed',
                top: '16px',
                left: '16px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
                fontSize: '20px',
                cursor: 'pointer',
                zIndex: 50,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              📊
            </button>
          </>
        )}

        <EmotionCorridor
          messages={state.messages}
          onEchoClick={handleEchoClick}
          onSendMessage={handleSendMessage}
          newMessageId={newMessageId}
        />
      </div>

      {!isMobile && (
        <SidePanel
          isOpen={state.isSidePanelOpen}
          message={selectedMessage}
          allMessages={state.messages}
          onClose={handleCloseSidePanel}
        />
      )}

      {isMobile && state.isSidePanelOpen && (
        <SidePanel
          isOpen={state.isSidePanelOpen}
          message={selectedMessage}
          allMessages={state.messages}
          onClose={handleCloseSidePanel}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          /* 移动端样式 */
        }
      `}</style>
    </div>
  );
};

export default App;
