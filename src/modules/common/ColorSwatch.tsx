import { memo, useState, useCallback } from 'react';
import type { PresetColor } from '@/utils/types';
import { COLOR_PALETTE, COLOR_NAMES, PRESET_COLORS } from '@/utils/constants';

interface ColorSwatchProps {
  value?: PresetColor | null;
  onChange?: (color: PresetColor) => void;
  size?: 'sm' | 'md' | 'lg';
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

function ColorSwatchComponent({
  value,
  onChange,
  size = 'md',
}: ColorSwatchProps) {
  const [ripples, setRipples] = useState<Map<string, Ripple>>(new Map());

  const sizes = {
    sm: { btn: 'w-7 h-7', ring: 'ring-2', selectedRing: 'ring-3' },
    md: { btn: 'w-10 h-10', ring: 'ring-2', selectedRing: 'ring-4' },
    lg: { btn: 'w-14 h-14', ring: 'ring-3', selectedRing: 'ring-5' },
  };

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, color: PresetColor) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rippleId = Date.now();
      const next = new Map(ripples);
      next.set(color, { id: rippleId, x, y });
      setRipples(next);

      setTimeout(() => {
        setRipples((curr) => {
          const m = new Map(curr);
          if (m.get(color)?.id === rippleId) m.delete(color);
          return m;
        });
      }, 500);

      onChange?.(color);
    },
    [ripples, onChange],
  );

  return (
    <div className="flex flex-wrap gap-3">
      {PRESET_COLORS.map((color) => {
        const selected = value === color;
        const hex = COLOR_PALETTE[color];
        const lightText = ['black', 'navy', 'burgundy', 'dark_brown'].includes(
          color,
        );
        const ripple = ripples.get(color);

        return (
          <div key={color} className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={(e) => handleClick(e, color)}
              className={`relative ${sizes[size].btn} rounded-full overflow-visible
                interactive-btn border border-white/30
                ${selected ? `${sizes[size].selectedRing} ring-brand-brown scale-110 transition-transform duration-200` : `${sizes[size].ring} ring-white/50 hover:ring-brand-brown/50`}`}
              style={{ backgroundColor: hex }}
              aria-label={`颜色${COLOR_NAMES[color]}`}
              title={COLOR_NAMES[color]}
            >
              {ripple && (
                <span
                  className="absolute pointer-events-none rounded-full animate-ripple"
                  style={{
                    left: ripple.x,
                    top: ripple.y,
                    width: 8,
                    height: 8,
                    marginLeft: -4,
                    marginTop: -4,
                    background: `radial-gradient(circle, ${
                      lightText ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.3)'
                    } 0%, transparent 70%)`,
                  }}
                />
              )}
              {selected && (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`absolute inset-0 m-auto w-1/2 h-1/2 animate-checkSlide ${
                    lightText ? 'text-white' : 'text-brand-dark'
                  }`}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
            <span className="text-xs text-brand-dark/70">{COLOR_NAMES[color]}</span>
          </div>
        );
      })}
    </div>
  );
}

ColorSwatchComponent.displayName = 'ColorSwatch';
export const ColorSwatch = memo(ColorSwatchComponent);
