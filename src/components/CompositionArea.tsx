import type { RefObject } from 'react';
import { CELL_SIZE, GRID_COLS, GRID_ROWS, ROW_GAP } from '../data/characters.ts';
import type { CompositionState } from '../state/composition.ts';
import { RACK_DRAG_TYPE } from './TypeRack.tsx';

interface CompositionAreaProps {
  state: CompositionState;
  shakingCell: number | null;
  imprint: boolean;
  boardRef: RefObject<HTMLDivElement>;
  onPlace: (charId: string, position: number) => void;
  onMove: (fromPosition: number, toPosition: number) => void;
  onTakeBack: (charId: string) => void;
  onClear: () => void;
}

interface DragPayload {
  source: 'rack' | 'board';
  id?: string;
  position?: number;
}

function readDragPayload(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(RACK_DRAG_TYPE);
  if (raw === '') return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export default function CompositionArea({
  state,
  shakingCell,
  imprint,
  boardRef,
  onPlace,
  onMove,
  onTakeBack,
  onClear
}: CompositionAreaProps) {
  const placedCount = state.board.reduce(
    (count, cell) => (cell === null ? count : count + 1),
    0
  );

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>,
    position: number
  ) => {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload === null) return;
    if (payload.source === 'rack' && payload.id !== undefined) {
      onPlace(payload.id, position);
    } else if (payload.source === 'board' && payload.position !== undefined) {
      onMove(payload.position, position);
    }
  };

  const blockStyle: React.CSSProperties = {
    width: CELL_SIZE - 10,
    height: CELL_SIZE - 10,
    fontSize: state.fontSize.value,
    color: state.inkColor.value,
    opacity: state.inkMix / 100
  };

  return (
    <section className="composition-wrap">
      <div className="composition-toolbar">
        <button
          type="button"
          className="bronze-button clear-button"
          onClick={onClear}
          aria-label="清空印版"
        >
          清空印版
        </button>
        <span className="placed-count">已排 {placedCount} 字</span>
      </div>
      <div
        ref={boardRef}
        className="composition-board"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLS}, ${CELL_SIZE}px)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, ${CELL_SIZE}px)`,
          columnGap: 0,
          rowGap: ROW_GAP
        }}
      >
        {state.board.map((cell, position) => (
          <div
            key={position}
            className={`composition-cell ${
              shakingCell === position ? 'shake' : ''
            } ${imprint ? 'imprint-flip' : ''}`}
            style={{ width: CELL_SIZE, height: CELL_SIZE }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => handleDrop(event, position)}
          >
            {cell !== null && (
              <div
                className="type-block placed wood-insert"
                draggable
                style={blockStyle}
                onDoubleClick={() => onTakeBack(cell.id)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    RACK_DRAG_TYPE,
                    JSON.stringify({ source: 'board', position })
                  );
                  event.dataTransfer.effectAllowed = 'move';
                }}
              >
                {cell.char}
              </div>
            )}
          </div>
        ))}
      </div>
      {placedCount === 0 && (
        <p className="empty-hint">请从右方字库拖拽字模</p>
      )}
      {imprint && <div className="imprint-overlay" aria-hidden />}
    </section>
  );
}
