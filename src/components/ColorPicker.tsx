import { useState, useEffect } from 'react';
import type { Swatch } from '../store';
import { hexToHsl, hslToHex, isValidHex } from '../utils/colorUtils';
import type { HSL } from '../utils/colorUtils';

interface ColorPickerProps {
  swatch: Swatch;
  onConfirm: (id: string, color: string) => void;
  onClose: () => void;
}

const ColorPicker = ({ swatch, onConfirm, onClose }: ColorPickerProps) => {
  const [hsl, setHsl] = useState<HSL>(hexToHsl(swatch.color));
  const [hexInput, setHexInput] = useState(swatch.color);

  useEffect(() => {
    const color = hslToHex(hsl);
    setHexInput(color);
  }, [hsl]);

  const handleHueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHsl(prev => ({ ...prev, h: parseInt(e.target.value, 10) }));
  };

  const handleSatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHsl(prev => ({ ...prev, s: parseInt(e.target.value, 10) }));
  };

  const handleLightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHsl(prev => ({ ...prev, l: parseInt(e.target.value, 10) }));
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHexInput(val);
    if (isValidHex(val)) {
      setHsl(hexToHsl(val));
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const currentColor = hslToHex(hsl);

  const satGradient = `linear-gradient(to right,
    hsl(${hsl.h}, 0%, ${hsl.l}%),
    hsl(${hsl.h}, 100%, ${hsl.l}%))`;

  const lightGradient = `linear-gradient(to right,
    hsl(${hsl.h}, ${hsl.s}%, 0%),
    hsl(${hsl.h}, ${hsl.s}%, 50%),
    hsl(${hsl.h}, ${hsl.s}%, 100%))`;

  return (
    <div className="color-picker-overlay" onClick={handleOverlayClick}>
      <div className="color-picker">
        <div
          className="color-picker__preview"
          style={{ backgroundColor: currentColor }}
        />
        <div className="color-picker__label">
          <span>色相 (H)</span>
          <span className="color-picker__value">{hsl.h}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          value={hsl.h}
          onChange={handleHueChange}
          className="color-picker__slider hue"
        />
        <div className="color-picker__label">
          <span>饱和度 (S)</span>
          <span className="color-picker__value">{hsl.s}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={hsl.s}
          onChange={handleSatChange}
          className="color-picker__slider"
          style={{ background: satGradient }}
        />
        <div className="color-picker__label">
          <span>亮度 (L)</span>
          <span className="color-picker__value">{hsl.l}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={hsl.l}
          onChange={handleLightChange}
          className="color-picker__slider"
          style={{ background: lightGradient }}
        />
        <div className="color-picker__hex">
          <span className="color-picker__label" style={{ marginBottom: 0 }}>HEX</span>
          <input
            type="text"
            value={hexInput}
            onChange={handleHexChange}
            className="color-picker__hex-input"
            maxLength={7}
          />
        </div>
        <div className="import-modal__actions">
          <button
            className="import-modal__btn import-modal__btn--cancel"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="import-modal__btn import-modal__btn--confirm"
            onClick={() => onConfirm(swatch.id, currentColor)}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColorPicker;
