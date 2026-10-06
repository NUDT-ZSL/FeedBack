import { useRef, useState } from 'react';
import type { Rect } from '../types.ts';
import { boxSelect, visibleCards } from '../engine/groups.ts';
import type { BoardApi } from '../hooks/useBoardState.ts';
import { CardView } from './CardView.tsx';
import { ConnectionsLayer } from './ConnectionsLayer.tsx';
import { GroupView } from './GroupView.tsx';

type DragState =
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'marquee'; startX: number; startY: number; currentX: number; currentY: number }
  | { kind: 'cards'; lastX: number; lastY: number; cardIds: string[] }
  | { kind: 'group'; lastX: number; lastY: number; groupId: string }
  | { kind: 'resize'; lastX: number; lastY: number; cardId: string };

interface BoardProps {
  api: BoardApi;
}

export function Board({ api }: BoardProps) {
  const { canvas, tool, selection } = api;
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  const toWorld = (clientX: number, clientY: number) => {
    const bounds = boardRef.current!.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - canvas.offsetX) / canvas.scale,
      y: (clientY - bounds.top - canvas.offsetY) / canvas.scale,
    };
  };

  const handleWheel = (event: React.WheelEvent) => {
    const bounds = boardRef.current!.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nextScale = Math.min(3, Math.max(0.5, canvas.scale * factor));
    const worldX = (pointerX - canvas.offsetX) / canvas.scale;
    const worldY = (pointerY - canvas.offsetY) / canvas.scale;
    api.setViewport(pointerX - worldX * nextScale, pointerY - worldY * nextScale, nextScale);
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent) => {
    const onInteractive = Boolean((event.target as Element).closest?.('.card, .group, .group__header'));
    if (onInteractive) return;
    api.setSelection({ cardIds: [], groupIds: [], connectionId: null });
    if (tool === 'boxSelect') {
      const point = toWorld(event.clientX, event.clientY);
      dragRef.current = { kind: 'marquee', startX: point.x, startY: point.y, currentX: point.x, currentY: point.y };
    } else {
      dragRef.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originX: canvas.offsetX,
        originY: canvas.offsetY,
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCardPointerDown = (event: React.PointerEvent, cardId: string) => {
    event.stopPropagation();
    if (tool === 'connect') {
      if (api.pendingConnectFrom === null) {
        api.setPendingConnectFrom(cardId);
      } else {
        api.addConnection(api.pendingConnectFrom, cardId);
        api.setPendingConnectFrom(null);
      }
      return;
    }
    const alreadySelected = selection.cardIds.includes(cardId);
    const nextCardIds = event.shiftKey
      ? alreadySelected
        ? selection.cardIds.filter((id) => id !== cardId)
        : [...selection.cardIds, cardId]
      : alreadySelected
        ? selection.cardIds
        : [cardId];
    api.setSelection({ cardIds: nextCardIds, groupIds: [], connectionId: null });
    const point = toWorld(event.clientX, event.clientY);
    dragRef.current = { kind: 'cards', lastX: point.x, lastY: point.y, cardIds: nextCardIds };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const handleResizeStart = (event: React.PointerEvent, cardId: string) => {
    const point = toWorld(event.clientX, event.clientY);
    dragRef.current = { kind: 'resize', lastX: point.x, lastY: point.y, cardId };
  };

  const handleGroupPointerDown = (event: React.PointerEvent, groupId: string) => {
    event.stopPropagation();
    if (tool === 'connect') return;
    api.setSelection({ cardIds: [], groupIds: [groupId], connectionId: null });
    const point = toWorld(event.clientX, event.clientY);
    dragRef.current = { kind: 'group', lastX: point.x, lastY: point.y, groupId };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      api.setViewport(
        drag.originX + (event.clientX - drag.startX),
        drag.originY + (event.clientY - drag.startY),
        canvas.scale,
      );
      return;
    }
    const point = toWorld(event.clientX, event.clientY);
    if (drag.kind === 'marquee') {
      drag.currentX = point.x;
      drag.currentY = point.y;
      setMarquee({
        x: Math.min(drag.startX, point.x),
        y: Math.min(drag.startY, point.y),
        width: Math.abs(point.x - drag.startX),
        height: Math.abs(point.y - drag.startY),
      });
      return;
    }
    const dx = point.x - drag.lastX;
    const dy = point.y - drag.lastY;
    if (drag.kind === 'cards') {
      api.moveCardsBy(drag.cardIds, dx, dy);
      drag.lastX = point.x;
      drag.lastY = point.y;
    } else if (drag.kind === 'group') {
      api.moveGroupBy(drag.groupId, dx, dy);
      drag.lastX = point.x;
      drag.lastY = point.y;
    } else if (drag.kind === 'resize') {
      const card = canvas.cards.find((item) => item.id === drag.cardId);
      if (card) {
        api.updateCard(card.id, {
          width: Math.max(160, card.width + dx),
          height: Math.max(120, card.height + dy),
        });
      }
      drag.lastX = point.x;
      drag.lastY = point.y;
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'marquee' && marquee) {
      const hit = boxSelect(canvas, marquee);
      api.setSelection({ cardIds: hit.cardIds, groupIds: hit.groupIds, connectionId: null });
    }
    setMarquee(null);
  };

  const groups = canvas.groups;
  const cards = visibleCards(canvas);

  return (
    <div
      ref={boardRef}
      className={`board board--tool-${tool}`}
      onWheel={handleWheel}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        className="board__world"
        style={{
          transform: `translate(${canvas.offsetX}px, ${canvas.offsetY}px) scale(${canvas.scale})`,
        }}
      >
        <ConnectionsLayer
          canvas={canvas}
          selectedConnectionId={selection.connectionId}
          onSelect={(connectionId) =>
            api.setSelection({ cardIds: [], groupIds: [], connectionId })
          }
        />
        {groups.map((group) => (
          <GroupView
            key={group.id}
            group={group}
            memberCards={group.memberIds
              .map((id) => canvas.cards.find((card) => card.id === id))
              .filter((card): card is NonNullable<typeof card> => Boolean(card))}
            selected={selection.groupIds.includes(group.id)}
            onToggleCollapse={api.groupActions.setCollapsed}
            onDelete={api.groupActions.remove}
            onRename={api.groupActions.rename}
            onPointerDown={handleGroupPointerDown}
          />
        ))}
        {cards.map((card) => (
          <CardView
            key={card.id}
            card={card}
            selected={selection.cardIds.includes(card.id)}
            connectPending={api.pendingConnectFrom === card.id}
            connectMode={tool === 'connect'}
            onPointerDown={handleCardPointerDown}
            onResizeStart={handleResizeStart}
            onUpdate={api.updateCard}
          />
        ))}
        {marquee && (
          <div
            className="board__marquee"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}
      </div>
    </div>
  );
}
