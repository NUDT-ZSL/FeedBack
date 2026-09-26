import React, { useEffect, useState, useRef } from 'react';
import chroma from 'chroma-js';
import type { ColorPalette, Adjustment, ColorItem } from './types';
import { store } from './store';
import { applyAdjustment } from './colorGenerator';

interface Props {
  expanded: boolean;
  onReload: (palette: ColorPalette) => void;
  onFavoritesChange: () => void;
}

interface ActiveAdjustments {
  [paletteId: string]: Adjustment[];
}

const FavoritesPanel: React.FC<Props> = ({ expanded, onReload, onFavoritesChange }) => {
  const [favorites, setFavorites] = useState<ColorPalette[]>(store.getFavorites());
  const [activePalId, setActivePalId] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<ActiveAdjustments>({});
  const updateTimerRefs = useRef<Record<string, number>>({});

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setFavorites(store.getFavorites());
      onFavoritesChange();
    });
    return unsub;
  }, [onFavoritesChange]);

  const ensureAdjustments = (pal: ColorPalette): Adjustment[] => {
    if (!adjustments[pal.id]) {
      return pal.colors.map(() => ({ lightness: 0, saturation: 0 }));
    }
    return adjustments[pal.id];
  };

  const getAdjustedColors = (pal: ColorPalette): ColorItem[] => {
    const adjs = ensureAdjustments(pal);
    return pal.colors.map((c, i) => applyAdjustment(c, adjs[i]));
  };

  const scheduleUpdate = (pal: ColorPalette, idx: number, key: 'lightness' | 'saturation', value: number) => {
    const adjs = ensureAdjustments(pal).map((a, i) => (i === idx ? { ...a, [key]: value } : a));
    setAdjustments((prev) => ({ ...prev, [pal.id]: adjs }));

    const timerKey = `${pal.id}-${idx}-${key}`;
    if (updateTimerRefs.current[timerKey]) {
      window.clearTimeout(updateTimerRefs.current[timerKey]);
    }
    updateTimerRefs.current[timerKey] = window.setTimeout(() => {
      const updatedColors = pal.colors.map((c, i) => applyAdjustment(c, adjs[i]));
      const existing = store.getById(pal.id);
      if (existing) {
        existing.colors = updatedColors;
        setFavorites(store.getFavorites());
      }
    }, 100);
  };

  const reloadToMain = (pal: ColorPalette) => {
    const adjs = ensureAdjustments(pal);
    const colors = pal.colors.map((c, i) => applyAdjustment(c, adjs[i]));
    onReload({ ...pal, colors });
  };

  const removeFav = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    store.removeFromFavorites(id);
    if (activePalId === id) setActivePalId(null);
  };

  return (
    <div
      style={{
        marginTop: 24,
        marginBottom: 16,
        overflow: 'hidden',
        maxHeight: expanded ? '400px' : 0,
        transition: 'max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        backgroundColor: '#333333',
        borderRadius: 12,
        border: expanded ? `1px solid #555555` : '1px solid transparent',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ padding: 16, maxHeight: '400px', overflowY: 'auto' }}>
        {favorites.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: '#9E9E9E',
              padding: '32px 0',
              fontSize: 14,
            }}
          >
            暂无收藏方案，点击配色方案右下角的红心收藏喜欢的方案 ✨
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {favorites.map((pal, fIdx) => {
              const isActive = activePalId === pal.id;
              const adjustedColors = isActive ? getAdjustedColors(pal) : pal.colors;
              const adjs = ensureAdjustments(pal);
              const timeStr = new Date(pal.timestamp).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <div
                  key={pal.id}
                  onClick={() => setActivePalId(isActive ? null : pal.id)}
                  style={{
                    backgroundColor: '#2A2A2A',
                    borderRadius: 10,
                    padding: 12,
                    cursor: 'pointer',
                    border: `1px solid ${isActive ? '#1E88E5' : '#3D3D3D'}`,
                    transition: 'border-color 0.2s ease, transform 0.2s ease',
                    opacity: 0,
                    animation: `favSlideIn 0.3s ease-out ${fIdx * 0.05}s forwards`,
                    transform: 'translateY(8px)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', flex: 1, gap: 4, minWidth: 0 }}>
                      {adjustedColors.map((c, i) => (
                        <div
                          key={i}
                          title={`${c.hex} · ${c.emotion}`}
                          style={{
                            flex: 1,
                            minWidth: 28,
                            height: 44,
                            borderRadius: 6,
                            backgroundColor: c.hex,
                            border: `1px solid ${chroma(c.hex).darken(1.2).hex()}`,
                            transition: 'background-color 0.15s ease',
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          flexWrap: 'wrap',
                          justifyContent: 'flex-end',
                          maxWidth: 200,
                        }}
                      >
                        {adjustedColors
                          .map((c) => c.emotion)
                          .filter((e, i, arr) => arr.indexOf(e) === i)
                          .slice(0, 2)
                          .map((tag, ti) => (
                            <span
                              key={ti}
                              style={{
                                fontSize: 10,
                                padding: '2px 8px',
                                borderRadius: 8,
                                backgroundColor: 'rgba(255,255,255,0.08)',
                                color: '#E0E0E0',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                      </div>
                      <div style={{ color: '#9E9E9E', fontSize: 11 }}>{timeStr}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 4 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          reloadToMain(pal);
                        }}
                        title="加载到主面板微调"
                        style={{
                          padding: '4px 10px',
                          fontSize: 11,
                          borderRadius: 12,
                          border: 'none',
                          cursor: 'pointer',
                          backgroundColor: '#1E88E5',
                          color: 'white',
                          fontWeight: 600,
                          transition: 'background-color 0.2s ease',
                        }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#42A5F5')}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1E88E5')}
                      >
                        加载
                      </button>
                      <button
                        onClick={(e) => removeFav(e, pal.id)}
                        title="移除收藏"
                        style={{
                          padding: '4px 10px',
                          fontSize: 11,
                          borderRadius: 12,
                          border: '1px solid #555',
                          cursor: 'pointer',
                          backgroundColor: 'transparent',
                          color: '#BDBDBD',
                          fontWeight: 500,
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.color = '#E53935';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#E53935';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.color = '#BDBDBD';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#555';
                        }}
                      >
                        移除
                      </button>
                    </div>
                  </div>

                  {isActive && (
                    <div
                      style={{
                        marginTop: 14,
                        padding: 12,
                        backgroundColor: '#1E1E1E',
                        borderRadius: 8,
                        border: '1px solid #3A3A3A',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: '#9E9E9E',
                          marginBottom: 10,
                          fontWeight: 600,
                        }}
                      >
                        微调颜色（亮度/饱和度 ±20%）
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {adjustedColors.map((c, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '28px 1fr 1fr',
                              gap: 10,
                              alignItems: 'center',
                            }}
                          >
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                backgroundColor: c.hex,
                                border: `1px solid ${chroma(c.hex).darken(1.2).hex()}`,
                              }}
                              title={c.hex}
                            />
                            <SliderRow
                              label="L"
                              value={adjs[i].lightness}
                              onChange={(v) => scheduleUpdate(pal, i, 'lightness', v)}
                              accent="#FFB74D"
                            />
                            <SliderRow
                              label="S"
                              value={adjs[i].saturation}
                              onChange={(v) => scheduleUpdate(pal, i, 'saturation', v)}
                              accent="#64B5F6"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes favSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

interface SliderRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  accent: string;
}

const SliderRow: React.FC<SliderRowProps> = ({ label, value, onChange, accent }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: '#BDBDBD',
          width: 14,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={-20}
        max={20}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          flex: 1,
          accentColor: accent,
          height: 4,
          cursor: 'pointer',
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: '#E0E0E0',
          width: 30,
          textAlign: 'right',
          fontWeight: 600,
        }}
      >
        {value > 0 ? '+' : ''}
        {value}%
      </span>
    </div>
  );
};

export default FavoritesPanel;
