import { FONT_SIZES, INK_COLORS } from '../data/characters.ts';
import type { CompositionState } from '../state/composition.ts';

interface InkControlProps {
  state: CompositionState;
  onInkColor: (value: string) => void;
  onFontSize: (value: number) => void;
  onInkMix: (value: number) => void;
  onImprint: () => void;
  onExport: () => void;
}

export default function InkControl({
  state,
  onInkColor,
  onFontSize,
  onInkMix,
  onImprint,
  onExport
}: InkControlProps) {
  return (
    <aside className="ink-control" aria-label="墨色与字号">
      <h2 className="panel-title">墨色</h2>
      <div className="ink-swatches">
        {INK_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            className={`ink-swatch ${
              state.inkColor.value === color.value ? 'active' : ''
            }`}
            style={{ backgroundColor: color.value }}
            title={color.name}
            aria-label={`墨色 ${color.name}`}
            onClick={() => onInkColor(color.value)}
          />
        ))}
      </div>
      <label className="ink-mix">
        浓淡 {state.inkMix}
        <input
          type="range"
          min={0}
          max={100}
          value={state.inkMix}
          onChange={(event) => onInkMix(Number(event.target.value))}
        />
      </label>
      <h2 className="panel-title">字号</h2>
      <div className="font-size-row">
        {FONT_SIZES.map((size) => (
          <button
            key={size.value}
            type="button"
            className={`bronze-button ${
              state.fontSize.value === size.value ? 'active' : ''
            }`}
            onClick={() => onFontSize(size.value)}
          >
            {size.name}
          </button>
        ))}
      </div>
      <div className="action-row">
        <button type="button" className="bronze-button" onClick={onImprint}>
          捺印
        </button>
        <button type="button" className="bronze-button" onClick={onExport}>
          导出 PNG
        </button>
      </div>
    </aside>
  );
}
