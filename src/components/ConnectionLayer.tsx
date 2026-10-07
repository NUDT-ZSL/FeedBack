import { useMemo } from 'react';
import type { CardGroup, Connection, Point, ResolvedConnection } from '../types.ts';
import { boundaryPoint, cardRect, collapsedGroupRect, rectCenter } from '../utils/geometry.ts';
import type { DragSession } from '../hooks/useDrag.ts';

interface ConnectionLayerProps {
  resolved: ResolvedConnection[];
  cardsById: Map<string, { id: string; x: number; y: number; width: number; height: number }>;
  groupsById: Map<string, CardGroup>;
  session: DragSession | null;
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
}

function targetRect(
  target: NonNullable<ResolvedConnection['from']>,
  cardsById: ConnectionLayerProps['cardsById'],
  groupsById: Map<string, CardGroup>,
) {
  if (target.kind === 'card') {
    const c = cardsById.get(target.id);
    return c ? cardRect(c) : null;
  }
  const g = groupsById.get(target.id);
  return g && g.collapsed ? collapsedGroupRect(g) : null;
}

function bezierPath(p1: Point, p2: Point): string {
  const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
  return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
}

export default function ConnectionLayer({
  resolved,
  cardsById,
  groupsById,
  session,
  selectedConnectionId,
  onSelectConnection,
}: ConnectionLayerProps) {
  const draft = useMemo(() => {
    if (!session || session.kind !== 'connect') return null;
    const card = cardsById.get(session.fromCardId);
    if (!card) return null;
    const rect = cardRect(card);
    return { from: boundaryPoint(rect, session.currentWorld), to: session.currentWorld };
  }, [session, cardsById]);

  return (
    <svg className="connection-layer">
      <defs>
        <marker id="arrow-default" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill="#aaaaaa" />
        </marker>
      </defs>
      {resolved.map((rc) => {
        if (rc.hiddenReason === 'same-collapsed-group') {
          // 同组且组折叠：连线随之隐藏；展开后自动恢复（数据未删除）
          return null;
        }
        if (rc.hiddenReason === 'dangling-endpoint') {
          // 引用缺失：明确以红色虚线 + 警告标记呈现，不静默丢弃，可点击删除
          const valid = rc.from ? targetRect(rc.from, cardsById, groupsById) : rc.to ? targetRect(rc.to, cardsById, groupsById) : null;
          const start = valid ? rectCenter(valid) : { x: 0, y: 0 };
          const end = { x: start.x + 60, y: start.y - 40 };
          return (
            <g key={rc.connection.id} className="connection--dangling" onClick={(e) => { e.stopPropagation(); onSelectConnection(rc.connection.id); }}>
              <path d={bezierPath(start, end)} className="connection__path connection__path--dangling" fill="none" />
              <text x={end.x} y={end.y} className="connection__warn">⚠</text>
            </g>
          );
        }

        const fromRect = rc.from && targetRect(rc.from, cardsById, groupsById);
        const toRect = rc.to && targetRect(rc.to, cardsById, groupsById);
        if (!fromRect || !toRect) return null;
        const c1 = rectCenter(fromRect);
        const c2 = rectCenter(toRect);
        const p1 = boundaryPoint(fromRect, c2);
        const p2 = boundaryPoint(toRect, c1);
        const c = rc.connection;
        const selected = selectedConnectionId === c.id;
        return <ConnectionCurve key={c.id} connection={c} p1={p1} p2={p2} selected={selected} onSelect={onSelectConnection} />;
      })}
      {draft && (
        <path d={bezierPath(draft.from, draft.to)} className="connection__path connection__path--draft" fill="none" />
      )}
    </svg>
  );
}

function ConnectionCurve({
  connection,
  p1,
  p2,
  selected,
  onSelect,
}: {
  connection: Connection;
  p1: Point;
  p2: Point;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  return (
    <g
      className={`connection ${selected ? 'connection--selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(connection.id);
      }}
    >
      {/* 宽透明命中区，便于选中细线 */}
      <path d={bezierPath(p1, p2)} fill="none" stroke="transparent" strokeWidth={14} />
      <path
        d={bezierPath(p1, p2)}
        className="connection__path"
        fill="none"
        stroke={connection.color}
        strokeWidth={selected ? 3 : 2}
        strokeDasharray={connection.type === 'dashed' ? '5,5' : undefined}
        markerEnd={`url(#arrow-${connection.id})`}
        style={selected ? { filter: `drop-shadow(0 0 6px ${connection.color})` } : undefined}
      />
      <defs>
        <marker id={`arrow-${connection.id}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill={connection.color} />
        </marker>
      </defs>
      <circle cx={p1.x} cy={p1.y} r={3.5} fill={connection.color} className="connection__dot" />
      {connection.label && (
        <g>
          <rect x={mid.x - connection.label.length * 7 - 6} y={mid.y - 11} width={connection.label.length * 14 + 12} height={20} rx={6} className="connection__label-bg" />
          <text x={mid.x} y={mid.y + 3} textAnchor="middle" className="connection__label">{connection.label}</text>
        </g>
      )}
    </g>
  );
}
