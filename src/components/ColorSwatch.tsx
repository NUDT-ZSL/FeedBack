import { useState, useRef } from 'react';
import { Trash2, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import Slider from './Slider';
import { cn } from '@/lib/utils';
import {
  hexToRgb,
  rgbToHex,
  hexToHsl,
  hslToHex,
  getContrastColor,
} from '@/utils/colorUtils';

interface ColorSwatchProps {
  hex: string;
  lightness: number;
  saturation: number;
  isDragging?: boolean;
  onHexChange: (hex: string) => void;
  onLightnessChange: (value: number) => void;
  onSaturationChange: (value: number) => void;
  onDelete: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  draggable?: boolean;
}

export default function ColorSwatch({
  hex,
  lightness,
  saturation,
  isDragging = false,
  onHexChange,
  onLightnessChange,
  onSaturationChange,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  draggable = true,
}: ColorSwatchProps) {
  const [showRgb, setShowRgb] = useState(false);
  const [isAnimating, setIsAnimating] = useState(true);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const rgb = hexToRgb(hex);
  const contrastColor = getContrastColor(hex);

  const handleRgbChange = (channel: 'r' | 'g' | 'b', value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0 || numValue > 255) return;
    const newRgb = { ...rgb, [channel]: numValue };
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    onHexChange(newHex);
    const newHsl = hexToHsl(newHex);
    onLightnessChange(newHsl.l);
    onSaturationChange(newHsl.s);
  };

  const handleLightnessChange = (value: number) => {
    const hsl = hexToHsl(hex);
    const newHex = hslToHex(hsl.h, saturation, value);
    onLightnessChange(value);
    onHexChange(newHex);
  };

  const handleSaturationChange = (value: number) => {
    const hsl = hexToHsl(hex);
    const newHex = hslToHex(hsl.h, value, lightness);
    onSaturationChange(value);
    onHexChange(newHex);
  };

  const handleHexInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let value = e.target.value.trim();
    if (!value.startsWith('#')) {
      value = '#' + value;
    }
    const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (hexRegex.test(value)) {
      onHexChange(value);
      const hsl = hexToHsl(value);
      onLightnessChange(hsl.l);
      onSaturationChange(hsl.s);
    }
  };

  return (
    <div
      className={cn(
        'group relative rounded-xl bg-white p-4 shadow-sm border border-gray-200',
        'dark:bg-gray-800 dark:border-gray-700 transition-all duration-300',
        isAnimating && 'animate-[popIn_0.3s_ease-out]',
        isDragging && 'scale-105 opacity-80 shadow-xl z-10'
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <style>{`
        @keyframes popIn {
          0% { transform: scale(0.8); opacity: 0; }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-2px); }
          75% { transform: translateX(2px); }
        }
      `}</style>

      <div className="mb-3 flex items-start justify-between gap-2">
        {draggable && (
          <div
            className="mt-1 cursor-grab text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300 active:cursor-grabbing"
            title="拖动排序"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}

        <div
          onClick={() => colorInputRef.current?.click()}
          className={cn(
            'relative h-20 w-full cursor-pointer rounded-lg border-2 transition-all duration-300',
            'hover:scale-[1.02] hover:shadow-md overflow-hidden'
          )}
          style={{
            backgroundColor: hex,
            borderColor: contrastColor === '#FFFFFF' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
            transition: 'background-color 0.3s ease, transform 0.2s ease',
          }}
        >
          <span
            className="absolute bottom-2 left-2 text-xs font-mono font-bold"
            style={{ color: contrastColor }}
          >
            {hex.toUpperCase()}
          </span>
          <input
            ref={colorInputRef}
            type="color"
            value={hex}
            onChange={(e) => {
              const newHex = e.target.value;
              onHexChange(newHex);
              const hsl = hexToHsl(newHex);
              onLightnessChange(hsl.l);
              onSaturationChange(hsl.s);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="颜色选择器"
          />
        </div>

        <button
          onClick={onDelete}
          className={cn(
            'mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            'text-gray-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500',
            'focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-400',
            'group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400'
          )}
          aria-label="删除颜色"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            HEX
          </label>
          <input
            type="text"
            defaultValue={hex.toUpperCase()}
            onBlur={handleHexInputBlur}
            className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-1.5 font-mono text-sm uppercase transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            maxLength={7}
            aria-label="HEX颜色值"
          />
        </div>

        <button
          onClick={() => setShowRgb(!showRgb)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          aria-expanded={showRgb}
        >
          <span>RGB</span>
          {showRgb ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showRgb && (
          <div className="grid grid-cols-3 gap-2 animate-[fadeIn_0.2s_ease-out]">
            {(['r', 'g', 'b'] as const).map((channel) => (
              <div key={channel}>
                <label className="mb-1 block text-[10px] font-medium text-gray-500 uppercase dark:text-gray-400">
                  {channel}
                </label>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[channel]}
                  onChange={(e) => handleRgbChange(channel, e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-center text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  aria-label={`RGB ${channel} 通道`}
                />
              </div>
            ))}
          </div>
        )}

        <Slider
          label="亮度"
          value={lightness}
          min={0}
          max={100}
          step={1}
          onChange={handleLightnessChange}
          color={hslToHex(hexToHsl(hex).h, 80, 50)}
        />

        <Slider
          label="饱和度"
          value={saturation}
          min={0}
          max={100}
          step={1}
          onChange={handleSaturationChange}
          color={hslToHex(hexToHsl(hex).h, 80, 50)}
        />
      </div>
    </div>
  );
}
