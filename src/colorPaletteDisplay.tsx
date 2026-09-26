import React, { useEffect, useState, useRef } from 'react';
import chroma from 'chroma-js';
import type { ColorPalette, ColorItem } from './types';
import { store } from './store';

interface Props {
  palette: ColorPalette;
  animationKey: number;
  onFavoriteChange: () => void;
}

interface CopyButtonState {
  index: number | null;
  copied: boolean;
}

const ColorPaletteDisplay: React.FC<Props> = ({ palette, animationKey, onFavoriteChange }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<CopyButtonState>({ index: null, copied: false });
  const [isFav, setIsFav] = useState(store.isFavorite(palette.id));
  const [heartAnim, setHeartAnim] = useState<'' | 'bounce' | 'shrink'>('');
  const detailRefs = useRef<(HTMLDivElement | null)[]>([]);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setIsFav(store.isFavorite(palette.id));
    });
    return unsub;
  }, [palette.id]);

  useEffect(() => {
    setIsFav(store.isFavorite(palette.id));
    setExpandedIndex(null);
  }, [palette.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (expandedIndex === null) return;
      const node = detailRefs.current[expandedIndex];
      if (node && !node.contains(e.target as Node)) {
        setExpandedIndex(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedIndex]);

  const copyHex = async (color: ColorItem, idx: number) => {
    try {
      await navigator.clipboard.writeText(color.hex);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = color.hex;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopyState({ index: idx, copied: true });
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopyState({ index: null, copied: false });
    }, 500);
  };

  const toggleHeart = () => {
    const willBeFav = store.toggleFavorite(palette);
    setIsFav(willBeFav);
    setHeartAnim(willBeFav ? 'bounce' : 'shrink');
    window.setTimeout(() => setHeartAnim(''), willBeFav ? 400 : 200);
    onFavoriteChange();
  };

  const timeStr = new Date(palette.timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const heartBounceKeyframes = `
    @keyframes heartBounce-${palette.id} {
      0% { transform: scale(1); }
      30% { transform: scale(1.2); }
      60% { transform: scale(0.95); }
      100% { transform: scale(1.0); }
    }
  `;

  return (
    <div style={{ position: 'relative' }}>
      <style>{heartBounceKeyframes}</style>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          gap: 16,
          padding: '32px 16px',
          flexWrap: 'wrap',
        }}
      >
        {palette.colors.map((color, idx) => {
          const borderColor = chroma(color.hex).darken(1.3).hex();
          const isExpanded = expandedIndex === idx;
          const isCopied = copyState.index === idx && copyState.copied;
          return (
            <div
              key={`${palette.id}-${idx}-${animationKey}`}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                opacity: 0,
                animation: `colorFadeIn 0.4s ease-out ${idx * 0.1}s forwards`,
              }}
            >
              <div
                data-idx={idx}
                onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                style={{
                  width: 120,
                  height: 200,
                  borderRadius: 8,
                  backgroundColor: color.hex,
                  border: `1px solid ${borderColor}`,
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  transform: 'translateY(0) scale(1)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    'translateY(-4px) scale(1.03)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    '0 8px 20px rgba(0,0,0,0.4)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    'translateY(0) scale(1)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    '0 2px 6px rgba(0,0,0,0.3)';
                }}
              />

              {isExpanded && (
                <div
                  ref={(el) => {
                    detailRefs.current[idx] = el;
                  }}
                  style={{
                    position: 'absolute',
                    top: 210,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 200,
                    minHeight: 120,
                    padding: 14,
                    backgroundColor: '#FAFAFA',
                    borderRadius: 12,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
                    zIndex: 50,
                    color: '#212121',
                    fontFamily:
                      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    animation: 'panelPop 0.2s ease-out',
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#757575',
                        marginBottom: 2,
                        letterSpacing: 0.5,
                      }}
                    >
                      HEX
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{color.hex}</span>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#757575',
                        marginBottom: 2,
                        letterSpacing: 0.5,
                      }}
                    >
                      RGB
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      rgb({color.rgb.r}, {color.rgb.g}, {color.rgb.b})
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyHex(color, idx);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 0',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                      color: '#FFFFFF',
                      fontSize: 13,
                      fontWeight: 600,
                      backgroundColor: isCopied ? '#388E3C' : '#1976D2',
                      transition: 'background-color 0.2s ease',
                    }}
                  >
                    {isCopied ? '已复制!' : '复制 HEX'}
                  </button>
                </div>
              )}

              <div
                style={{
                  marginTop: 14,
                  padding: '4px 12px',
                  borderRadius: 12,
                  backgroundColor: chroma(color.hex).alpha(0.3).css(),
                  color: chroma(color.hex).luminance() > 0.5 ? '#212121' : '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 600,
                  backdropFilter: 'blur(4px)',
                }}
              >
                {color.emotion}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 24px 16px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ color: '#9E9E9E', fontSize: 13 }}>
          生成时间：{timeStr}
        </div>

        <button
          onClick={toggleHeart}
          aria-label="收藏"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 8,
            display: 'flex',
            alignItems: 'center',
            animation:
              heartAnim === 'bounce'
                ? `heartBounce-${palette.id} 0.4s ease-out`
                : heartAnim === 'shrink'
                ? 'heartShrink 0.2s ease-out'
                : 'none',
          }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill={isFav ? '#E53935' : 'none'}
            stroke={isFav ? '#E53935' : '#757575'}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transition: 'all 0.2s ease' }}
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes colorFadeIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes panelPop {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.96); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes heartShrink {
          0% { transform: scale(1); }
          50% { transform: scale(0.85); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default ColorPaletteDisplay;
