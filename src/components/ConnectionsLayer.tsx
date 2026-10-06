import type { CanvasState } from '../types.ts';
import { resolveConnection } from '../engine/groups.ts';

interface ConnectionsLayerProps {
  canvas: CanvasState;
  selectedConnectionId: string | null;
  onSelect: (connectionId: string) => void;
}

const ARROW_SIZE = 10;

export function ConnectionsLayer({ canvas, selectedConnectionId, onSelect }: ConnectionsLayerProps) {
  return (
    <svg className="connections-layer">
      {canvas.connections.map((conn) => {
        const resolved = resolveConnection(canvas, conn);
        if (!resolved || resolved.hidden) return null;
        const { from, to } = resolved;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const selected = conn.id === selectedConnectionId;
        const tip = conn.type === 'arrow'
          ? {
              x: to.x - Math.cos(angle) * 2,
              y: to.y - Math.sin(angle) * 2,
            }
          : to;
        const lineEnd = conn.type === 'arrow'
          ? { x: to.x - Math.cos(angle) * ARROW_SIZE, y: to.y - Math.sin(angle) * ARROW_SIZE }
          : to;
        const arrowLeft = {
          x: tip.x - Math.cos(angle - 0.45) * ARROW_SIZE,
          y: tip.y - Math.sin(angle - 0.45) * ARROW_SIZE,
        };
        const arrowRight = {
          x: tip.x - Math.cos(angle + 0.45) * ARROW_SIZE,
          y: tip.y - Math.sin(angle + 0.45) * ARROW_SIZE,
        };
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        return (
          <g key={conn.id}>
            <line
              x1={from.x}
              y1={from.y}
              x2={lineEnd.x}
              y2={lineEnd.y}
              stroke={conn.color}
              strokeWidth={selected ? 3 : 2}
              strokeDasharray={conn.type === 'dashed' ? '8 6' : undefined}
            />
            {conn.type === 'arrow' && (
              <polygon
                points={`${tip.x},${tip.y} ${arrowLeft.x},${arrowLeft.y} ${arrowRight.x},${arrowRight.y}`}
                fill={conn.color}
              />
            )}
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="transparent"
              strokeWidth={14}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(conn.id);
              }}
            />
            {conn.label && (
              <text x={mid.x} y={mid.y - 6} textAnchor="middle" className="connection-label" fill={conn.color}>
                {conn.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
