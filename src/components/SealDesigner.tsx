import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { SealDocument } from '@/types';
import { MAX_CHARACTERS } from '@/core/seal';
import { STONE_COLOR, STONE_DARK, YANGKE_STROKE, YINKE_STROKE, canvasSizeFor, strokeTransform } from '@/core/renderer';
import { useWorkbench } from '@/store/workbenchStore';

interface SealDesignerProps {
  seal: SealDocument;
  pressing: boolean;
}

export default function SealDesigner({ seal, pressing }: SealDesignerProps) {
  const setCharacters = useWorkbench((state) => state.setCharacters);
  const dragStroke = useWorkbench((state) => state.dragStroke);
  const releaseStroke = useWorkbench((state) => state.releaseStroke);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { state } = seal;
  const canvasSize = canvasSizeFor(state);
  const strokeFill = state.style === 'yinke' ? YINKE_STROKE : YANGKE_STROKE;
  const bgFill = state.style === 'yinke' ? STONE_COLOR : STONE_DARK;

  const toCanvasPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const scale = canvasSize / rect.width;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };

  const handlePointerDown = (strokeId: string) => (event: PointerEvent) => {
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragOrigin.current = toCanvasPoint(event);
    setDraggingId(strokeId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!draggingId || !dragOrigin.current) return;
    const point = toCanvasPoint(event);
    dragStroke(draggingId, {
      x: point.x - dragOrigin.current.x,
      y: point.y - dragOrigin.current.y,
    });
  };

  const handlePointerUp = () => {
    if (!draggingId) return;
    const releasedId = draggingId;
    dragOrigin.current = null;
    setDraggingId(null);
    releaseStroke(releasedId);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-2">
        {Array.from({ length: MAX_CHARACTERS }).map((_, index) => (
          <input
            key={index}
            aria-label={`第${index + 1}字`}
            className="h-12 w-12 rounded-lg border-2 border-[#b8a07a] bg-[#fcf6e6] text-center text-xl text-[#4a4632] focus:border-[#cc3333] focus:outline-none"
            maxLength={1}
            value={state.characters[index] ?? ''}
            onChange={(event) => {
              const next = [...state.characters];
              while (next.length < index) next.push('');
              if (event.target.value) {
                next[index] = Array.from(event.target.value)[0];
              } else {
                next.splice(index, 1);
              }
              setCharacters(next.join(''));
            }}
          />
        ))}
      </div>
      <div
        className={`rounded-xl shadow-lg transition-transform duration-300 ${
          pressing ? 'scale-90 rotate-2' : 'scale-100 rotate-0'
        }`}
        style={{ transitionDuration: pressing ? '400ms' : '400ms' }}
      >
        <svg
          ref={svgRef}
          width={canvasSize}
          height={canvasSize}
          viewBox={`0 0 ${canvasSize} ${canvasSize}`}
          className="rounded-xl cursor-crosshair select-none touch-none"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <rect
            x={0}
            y={0}
            width={canvasSize}
            height={canvasSize}
            rx={10}
            fill={bgFill}
            style={{ transition: 'fill 0.5s ease-in-out' }}
          />
          <rect
            x={6}
            y={6}
            width={canvasSize - 12}
            height={canvasSize - 12}
            rx={8}
            fill="none"
            stroke="rgba(0,0,0,0.18)"
            strokeWidth={2}
          />
          {state.strokes.map((stroke) => (
            <path
              key={stroke.id}
              d={stroke.path}
              fill={strokeFill}
              transform={strokeTransform(stroke, canvasSize)}
              style={{
                transition: draggingId ? 'fill 0.5s ease-in-out' : 'transform 0.3s ease-in-out, fill 0.5s ease-in-out',
                cursor: 'move',
              }}
              onPointerDown={handlePointerDown(stroke.id)}
            />
          ))}
        </svg>
      </div>
      <p className="text-sm text-[#8a7a58]">
        {state.characters.length === 0
          ? '在上方空格中输入印文（最多四字）'
          : '拖拽笔画可微调位置，松开自动归位'}
      </p>
    </div>
  );
}
