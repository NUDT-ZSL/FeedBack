import { useRef, useState, useCallback } from 'react';
import { usePaletteStore, type Swatch, type SemanticTag } from '../store';

const GRID_SIZE = 16;
const SWATCH_SIZE = 80;

interface WorkAreaProps {
  onSwatchDoubleClick: (swatch: Swatch) => void;
}

interface DropHint {
  x: number;
  y: number;
  visible: boolean;
}

const snapToGrid = (value: number): number => {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
};

const WorkArea = ({ onSwatchDoubleClick }: WorkAreaProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { swatches, addSwatch, removeSwatch } = usePaletteStore();
  const [dropHint, setDropHint] = useState<DropHint>({ x: 0, y: 0, visible: false });
  const [, setDraggingSwatch] = useState<string | null>(null);

  const getGridPosition = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const scrollTop = containerRef.current.scrollTop;
    const x = snapToGrid(clientX - rect.left + scrollLeft - SWATCH_SIZE / 2);
    const y = snapToGrid(clientY - rect.top + scrollTop - SWATCH_SIZE / 2);
    return { x: Math.max(0, x), y: Math.max(0, y) };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const pos = getGridPosition(e.clientX, e.clientY);
    setDropHint({ x: pos.x + SWATCH_SIZE / 2, y: pos.y + SWATCH_SIZE / 2, visible: true });
  }, [getGridPosition]);

  const handleDragLeave = useCallback(() => {
    setDropHint(prev => ({ ...prev, visible: false }));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropHint(prev => ({ ...prev, visible: false }));

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data && data.tag) {
        const pos = getGridPosition(e.clientX, e.clientY);
        addSwatch(data.tag as SemanticTag, pos.x, pos.y);
      }
    } catch {
      // ignore invalid data
    }
  }, [addSwatch, getGridPosition]);

  const handleSwatchMouseDown = useCallback((e: React.MouseEvent, swatchId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDraggingSwatch(swatchId);
  }, []);

  return (
    <div className="work-area-wrapper">
      <div
        ref={containerRef}
        className="work-area"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="work-area__grid" />
        {swatches.length === 0 && (
          <div className="work-area__placeholder">
            从左侧拖拽语义色块到此处开始构建色板
          </div>
        )}
        {dropHint.visible && (
          <div
            className="work-area__drop-hint"
            style={{ left: dropHint.x, top: dropHint.y }}
          />
        )}
        {swatches.map((swatch) => (
          <div
            key={swatch.id}
            className="work-swatch"
            style={{ left: swatch.x, top: swatch.y }}
            onMouseDown={(e) => handleSwatchMouseDown(e, swatch.id)}
            onDoubleClick={() => onSwatchDoubleClick(swatch)}
          >
            <div
              className="work-swatch__circle"
              style={{ backgroundColor: swatch.color }}
            />
            <div className="work-swatch__label">
              <span className="work-swatch__name">{swatch.name}</span>
              <span className="work-swatch__color">{swatch.color}</span>
            </div>
            <button
              className="work-swatch__remove"
              onClick={(e) => {
                e.stopPropagation();
                removeSwatch(swatch.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkArea;
