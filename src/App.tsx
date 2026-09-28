import React, { useState, useMemo } from 'react'
import CanvasRenderer from './CanvasRenderer'
import EmotionCalendar from './EmotionCalendar'
import { analyzeText, ParagraphAnalysis, EMOTION_CONFIGS } from './EmotionAnalyzer'

type TabType = 'write' | 'calendar' | 'gallery'

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('write')
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left')
  const [text, setText] = useState('')
  const [analysis, setAnalysis] = useState<ParagraphAnalysis[]>([])
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0)
  const [showResultPanel, setShowResultPanel] = useState(false)

  const handleTabChange = (tab: TabType) => {
    setSlideDirection(tab > activeTab ? 'left' : 'right')
    setActiveTab(tab)
  }

  const handleAnalyze = () => {
    if (!text.trim()) return
    const result = analyzeText(text)
    setAnalysis(result)
    setCurrentParagraphIndex(0)
    setShowResultPanel(true)
  }

  const getEmotionKeyByColor = (color: string): string => {
    for (const [key, conf] of Object.entries(EMOTION_CONFIGS)) {
      if (conf.color === color) return key
    }
    return 'peace'
  }

  const galleryItems = useMemo(() => [
    { title: '春日暖阳', emotion: 'joy', description: '温暖的喜悦，如阳光洒落心间' },
    { title: '静谧湖水', emotion: 'peace', description: '心如止水，万物皆安' },
    { title: '暮色沉心', emotion: 'sadness', description: '在蓝调中，与忧伤和解' },
    { title: '燃焰时刻', emotion: 'anger', description: '让愤怒燃烧，化为力量' },
    { title: '晨曦微光', emotion: 'peace', description: '清晨第一缕光的温柔' },
    { title: '繁花盛开', emotion: 'joy', description: '喜悦如繁花，肆意绽放' }
  ], [])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#000000',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    }}>
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div
          key={activeTab}
          style={{
            width: '100%',
            height: '100%',
            animation: `slideIn_${slideDirection} 0.3s ease-out`
          }}
        >
          {activeTab === 'write' && (
            <div style={{
              display: 'flex',
              width: '100%',
              height: '100%',
              position: 'relative'
            }}>
              <div style={{
                width: '420px',
                minWidth: '420px',
                background: '#1e1e2e',
                padding: '32px',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box',
                borderRight: '1px solid rgba(255, 255, 255, 0.05)'
              }}>
                <div style={{ marginBottom: '32px' }}>
                  <h1 style={{
                    color: '#ffffff',
                    fontSize: '26px',
                    margin: 0,
                    marginBottom: '8px',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #cba6f7 0%, #89b4fa 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                  }}>
                    编织情绪笔记
                  </h1>
                  <p style={{
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: '13px',
                    margin: 0,
                    lineHeight: 1.6
                  }}>
                    写下你的心情，让文字化作会呼吸的画
                  </p>
                </div>

                <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{
                    color: 'rgba(255,255,255,0.8)',
                    fontSize: '14px',
                    fontWeight: 500
                  }}>
                    今日心情
                  </label>
                  <span style={{
                    color: text.length > 1000 ? '#ff6b6b' : 'rgba(255,255,255,0.4)',
                    fontSize: '12px'
                  }}>
                    {text.length}/1000
                  </span>
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, 1000))}
                  placeholder="在这里写下你的心情...每段文字都会被编织成独特的情绪画面"
                  style={{
                    flex: 1,
                    minHeight: '200px',
                    background: '#11111b',
                    color: '#ffffff',
                    border: '1px solid transparent',
                    borderRadius: '14px',
                    padding: '20px',
                    fontSize: '15px',
                    lineHeight: 1.8,
                    resize: 'none',
                    outline: 'none',
                    transition: 'all 0.3s ease',
                    fontFamily: 'inherit',
                    caretColor: '#89b4fa'
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderImage = 'linear-gradient(135deg, #cba6f7 0%, #89b4fa 100%) 1'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderImage = 'none'
                    e.currentTarget.style.border = '1px solid transparent'
                  }}
                />

                <button
                  onClick={handleAnalyze}
                  disabled={!text.trim()}
                  style={{
                    marginTop: '24px',
                    padding: '16px 32px',
                    background: text.trim()
                      ? 'linear-gradient(135deg, #cba6f7 0%, #89b4fa 100%)'
                      : 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: '14px',
                    color: text.trim() ? '#1e1e2e' : 'rgba(255,255,255,0.3)',
                    fontSize: '15px',
                    fontWeight: 600,
                    cursor: text.trim() ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease',
                    letterSpacing: '0.5px'
                  }}
                  onMouseOver={(e) => {
                    if (text.trim()) {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 8px 25px rgba(203, 166, 247, 0.35)'
                    }
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  色彩分析
                </button>

                {analysis.length > 1 && (
                  <div style={{
                    marginTop: '20px',
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap'
                  }}>
                    {analysis.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCurrentParagraphIndex(idx)}
                        style={{
                          padding: '6px 14px',
                          background: idx === currentParagraphIndex
                            ? 'linear-gradient(135deg, #cba6f7 0%, #89b4fa 100%)'
                            : 'rgba(255, 255, 255, 0.06)',
                          border: 'none',
                          borderRadius: '8px',
                          color: idx === currentParagraphIndex ? '#1e1e2e' : 'rgba(255,255,255,0.7)',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        段落 {idx + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, position: 'relative', height: '100%' }}>
                <CanvasRenderer
                  analysis={analysis}
                  currentParagraphIndex={currentParagraphIndex}
                />

                {showResultPanel && analysis.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: '300px',
                      background: 'rgba(17, 17, 27, 0.96)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                      padding: '24px 32px',
                      boxSizing: 'border-box',
                      animation: 'slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                      overflowY: 'auto'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                      <div>
                        <h3 style={{ color: '#ffffff', margin: 0, fontSize: '18px', marginBottom: '4px' }}>
                          情绪分析结果
                        </h3>
                        <p style={{ color: 'rgba(255,255,255,0.5)', margin: 0, fontSize: '13px' }}>
                          当前段落 {currentParagraphIndex + 1} / {analysis.length}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowResultPanel(false)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: 'none',
                          color: 'rgba(255,255,255,0.7)',
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)' }}
                        onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
                      >
                        ↓
                      </button>
                    </div>

                    {analysis[currentParagraphIndex] && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {analysis[currentParagraphIndex].emotions.map((emotion, idx) => {
                          const emotionKey = getEmotionKeyByColor(emotion.color)
                          const conf = EMOTION_CONFIGS[emotionKey]
                          const barColor = conf ? `linear-gradient(90deg, ${conf.gradient[0]}, ${conf.gradient[1]}, ${conf.gradient[2]})` : '#89b4fa'
                          return (
                            <div key={idx}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ color: '#ffffff', fontSize: '13px' }}>
                                  {emotion.keyword}
                                  <span style={{
                                    marginLeft: '8px',
                                    padding: '2px 8px',
                                    background: emotion.color + '30',
                                    color: emotion.color,
                                    borderRadius: '4px',
                                    fontSize: '11px'
                                  }}>
                                    {conf?.name || '未知'}
                                  </span>
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
                                  {(emotion.confidence * 100).toFixed(1)}%
                                </span>
                              </div>
                              <div style={{
                                height: '8px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                borderRadius: '4px',
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  height: '100%',
                                  background: barColor,
                                  width: `${emotion.confidence * 100}%`,
                                  borderRadius: '4px',
                                  transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
                                }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {!showResultPanel && analysis.length > 0 && (
                  <button
                    onClick={() => setShowResultPanel(true)}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: '80px',
                      transform: 'translateX(-50%)',
                      background: 'rgba(30, 30, 46, 0.9)',
                      backdropFilter: 'blur(10px)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#ffffff',
                      padding: '10px 24px',
                      borderRadius: '20px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(30, 30, 46, 1)' }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(30, 30, 46, 0.9)' }}
                  >
                    ↑ 查看情绪分析
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'calendar' && (
            <div style={{
              width: '100%',
              height: '100%',
              background: '#11111b'
            }}>
              <EmotionCalendar />
            </div>
          )}

          {activeTab === 'gallery' && (
            <div style={{
              width: '100%',
              height: '100%',
              background: '#11111b',
              padding: '40px',
              boxSizing: 'border-box',
              overflowY: 'auto'
            }}>
              <h2 style={{ color: '#ffffff', fontSize: '28px', margin: 0, marginBottom: '8px', fontWeight: 700 }}>
                探索画廊
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', margin: 0, marginBottom: '36px', fontSize: '14px' }}>
                欣赏他人的情绪艺术，寻找共鸣
              </p>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '24px'
              }}>
                {galleryItems.map((item, idx) => {
                  const conf = EMOTION_CONFIGS[item.emotion]
                  return (
                    <div
                      key={idx}
                      style={{
                        background: `linear-gradient(135deg, ${conf.gradient[0]} 0%, ${conf.gradient[1]} 50%, ${conf.gradient[2]} 100%)`,
                        borderRadius: '20px',
                        padding: '24px',
                        minHeight: '220px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.transform = 'translateY(-6px)'
                        e.currentTarget.style.boxShadow = `0 20px 50px ${conf.color}40`
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2) 0%, transparent 60%)`,
                        pointerEvents: 'none'
                      }} />
                      <div style={{ position: 'relative' }}>
                        <span style={{
                          background: 'rgba(255, 255, 255, 0.25)',
                          padding: '4px 12px',
                          borderRadius: '12px',
                          color: '#ffffff',
                          fontSize: '12px',
                          backdropFilter: 'blur(4px)'
                        }}>
                          {conf.name}
                        </span>
                      </div>
                      <div style={{ position: 'relative' }}>
                        <h3 style={{
                          color: '#ffffff',
                          margin: 0,
                          marginBottom: '8px',
                          fontSize: '20px',
                          fontWeight: 700
                        }}>
                          {item.title}
                        </h3>
                        <p style={{
                          color: 'rgba(255,255,255,0.85)',
                          margin: 0,
                          fontSize: '13px',
                          lineHeight: 1.6
                        }}>
                          {item.description}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{
        height: '64px',
        background: '#11111b',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '48px',
        padding: '0 24px'
      }}>
        {[
          { key: 'write' as TabType, label: '写笔记', icon: '✎' },
          { key: 'calendar' as TabType, label: '情绪日历', icon: '▤' },
          { key: 'gallery' as TabType, label: '探索画廊', icon: '◈' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === tab.key ? '#ffffff' : 'rgba(255,255,255,0.45)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '10px',
              transition: 'all 0.2s ease',
              fontSize: '14px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              position: 'relative'
            }}
            onMouseOver={(e) => {
              if (activeTab !== tab.key) {
                e.currentTarget.style.color = 'rgba(255,255,255,0.75)'
              }
            }}
            onMouseOut={(e) => {
              if (activeTab !== tab.key) {
                e.currentTarget.style.color = 'rgba(255,255,255,0.45)'
              }
            }}
          >
            <span style={{ fontSize: '16px' }}>{tab.icon}</span>
            {tab.label}
            {activeTab === tab.key && (
              <div style={{
                position: 'absolute',
                bottom: '-18px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '24px',
                height: '3px',
                background: 'linear-gradient(90deg, #cba6f7, #89b4fa)',
                borderRadius: '2px'
              }} />
            )}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes slideIn_left {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideIn_right {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        textarea::placeholder {
          color: rgba(255, 255, 255, 0.25);
        }
        textarea::-webkit-scrollbar {
          width: 6px;
        }
        textarea::-webkit-scrollbar-track {
          background: transparent;
        }
        textarea::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
        }
      `}</style>
    </div>
  )
}

export default App
