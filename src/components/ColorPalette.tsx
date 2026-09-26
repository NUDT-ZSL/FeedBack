import { PRESET_SWATCHES, type SemanticTag } from '../store';

interface ColorPaletteProps {
  onDragStart: (tag: SemanticTag, color: string) => void;
}

const ColorPalette = ({ onDragStart }: ColorPaletteProps) => {
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, tag: SemanticTag, color: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ tag, color }));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart(tag, color);
  };

  return (
    <aside className="color-palette">
      <h2 className="color-palette__title">语义色块</h2>
      <div className="color-palette__list">
        {PRESET_SWATCHES.map((swatch) => (
          <div
            key={swatch.tag}
            className="palette-swatch"
            draggable
            onDragStart={(e) => handleDragStart(e, swatch.tag, swatch.color)}
          >
            <div
              className="palette-swatch__circle"
              style={{ backgroundColor: swatch.color }}
            />
            <div className="palette-swatch__info">
              <span className="palette-swatch__name">{swatch.name}</span>
              <span className="palette-swatch__color">{swatch.color}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};

export default ColorPalette;
