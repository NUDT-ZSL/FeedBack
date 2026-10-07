import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Point, Rect } from '../types.ts';
import { CONNECTION_COLORS, GRID_SIZE, LABEL_MAX_LENGTH } from '../types.ts';
import type { CanvasApi } from '../hooks/useCanvasState.ts';
import { useDrag } from '../hooks/useDrag.ts';
import { useConnections } from '../hooks/useConnections.ts';
import { cardRect, collapsedGroupRect, rectsIntersect, rectContainsPoint } from '../utils/geometry.ts';
import CardView from './Card.tsx';
import GroupView from './GroupView.tsx';
import ConnectionLayer from './ConnectionLayer.tsx';

interface BoardProps {
  api: CanvasApi;
}

export default function Board({ api }: BoardProps) {
  const { state } = api;
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const connections = useConnections(api);

  const toWorld = useCallback(
    (client: Point): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return {
        x: (client.x - left - state.offsetX) / state.scale,
        y: (client.y - top - state.offsetY) / state.scale,
      };
    },
    [state.offsetX, state.offsetY, state.scale],
  );

  const hitCard = useCallback(
    (world: Point): string | null => {
      for (let i = state.cards.length - 1; i >= 0; i--) {
        const card = state.cards[i];
        if (api.hiddenCardIds.has(card.id)) continue;
        if (rectContainsPoint(cardRect(card), world)) return card.id;
      }
      return null;
    },
    [state.cards, api.hiddenCardIds],
  );

  const onBoxSelect = useCallback(
    (rect: Rect, additive: boolean) => {
      // 折叠卡组优先：命中其容器即选中卡组本身，不触及内部卡片
      const hitGroups = state.groups
        .filter((g) => g.collapsed && rectsIntersect(collapsedGroupRect(g), rect))
        .map((g) => g.id);
      if (hitGroups.length > 0) {
        api.selectGroups(hitGroups, additive);
        return;
      }
      const hitCards = state.cards
        .filter((c) => !api.hiddenCardIds.has(c.id) && rectsIntersect(cardRect(c), rect))
        .map((c) => c.id);
      api.selectCards(hitCards, additive);
    },
    [state.groups, state.cards, api],
  );

  const onConnect = useCallback(
    (fromCardId: string, toCardId: string | null) => {
      if (!toCardId || toCardId === fromCardId) return;
      const created = connections.createConnection(fromCardId, toCardId, 'arrow');
      if (created) setSelectedConnectionId(created.id);
    },
    [connections],
  );

  const drag = useDrag({
    toWorld,
    onPan: (x, y) => api.setViewport(x, y, state.scale),
    onSetCardPositions: api.setCardPositions,
    onMoveGroupChip: api.moveGroupChip,
    onBoxSelect,
    onConnect,
    hitCard,
  });

  // ---------- 背景交互 ----------
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('board__world')) return;
    const client = { x: e.clientX, y: e.clientY };
    if (e.button === 2 || e.button === 1) {
      drag.beginPan(client, { x: state.offsetX, y: state.offsetY });
      return;
    }
    if (e.button !== 0) return;
    setSelectedConnectionId(null);
    if (api.mode === 'boxSelect') {
      drag.beginBoxSelect(client);
    } else {
      api.clearSelection();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const center = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : undefined;
    api.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, center);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('board__world')) return;
    if (api.mode !== 'select') return;
    const world = toWorld({ x: e.clientX, y: e.clientY });
    api.addCard(world.x, world.y);
  };

  // ---------- 卡片交互 ----------
  const onCardBodyPointerDown = (e: React.PointerEvent, cardId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const already = api.selectedCardIds.includes(cardId);
    const ids = e.shiftKey
      ? already
        ? api.selectedCardIds.filter((id) => id !== cardId)
        : [...api.selectedCardIds, cardId]
      : already
        ? api.selectedCardIds
        : [cardId];
    api.selectCards(ids, false);
    if (api.mode === 'connect') {
      drag.beginConnect(cardId, { x: e.clientX, y: e.clientY });
      return;
    }
    const origins = new Map<string, Point>();
    for (const id of ids) {
      const card = api.cardsById.get(id);
      if (card) origins.set(id, { x: card.x, y: card.y });
    }
    drag.beginCards({ x: e.clientX, y: e.clientY }, origins);
  };

  // ---------- 卡组交互 ----------
  const onGroupPointerDown = (e: React.PointerEvent, groupId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    api.selectGroups([groupId]);
    const group = api.groupsById.get(groupId);
    if (!group) return;
    if (group.collapsed) {
      drag.beginGroupChip(groupId, { x: e.clientX, y: e.clientY }, { x: group.x, y: group.y });
    } else {
      // 展开态拖动标题栏 = 整体移动成员，容器包围盒自动跟随，相对关系不变
      const origins = new Map<string, Point>();
      for (const mid of group.memberIds) {
        const card = api.cardsById.get(mid);
        if (card) origins.set(mid, { x: card.x, y: card.y });
      }
      if (origins.size > 0) drag.beginCards({ x: e.clientX, y: e.clientY }, origins);
    }
  };

  // ---------- 键盘 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (api.selectedCardIds.length > 0) api.deleteCards(api.selectedCardIds);
        for (const gid of api.selectedGroupIds) api.deleteGroup(gid);
        if (selectedConnectionId) {
          connections.deleteConnection(selectedConnectionId);
          setSelectedConnectionId(null);
        }
      } else if (e.key === 'Escape') {
        api.clearSelection();
        setSelectedConnectionId(null);
        drag.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, connections, selectedConnectionId, drag]);

  const selectedConnection = useMemo(
    () => state.connections.find((c) => c.id === selectedConnectionId) ?? null,
    [state.connections, selectedConnectionId],
  );

  const hiddenConnectionCountByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const rc of api.resolvedConnections) {
      if (rc.hiddenReason === 'same-collapsed-group' && rc.from?.kind === 'group') {
        map.set(rc.from.id, (map.get(rc.from.id) ?? 0) + 1);
      }
    }
    return map;
  }, [api.resolvedConnections]);

  const boxRect =
    drag.session?.kind === 'boxSelect'
      ? {
          x: Math.min(drag.session.startWorld.x, drag.session.currentWorld.x),
          y: Math.min(drag.session.startWorld.y, drag.session.currentWorld.y),
          width: Math.abs(drag.session.startWorld.x - drag.session.currentWorld.x),
          height: Math.abs(drag.session.startWorld.y - drag.session.currentWorld.y),
        }
      : null;

  return (
    <div
      ref={containerRef}
      className="board"
      onPointerDown={onBackgroundPointerDown}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        backgroundSize: `${GRID_SIZE * state.scale}px ${GRID_SIZE * state.scale}px`,
        backgroundPosition: `${state.offsetX}px ${state.offsetY}px`,
      }}
    >
      <div
        className="board__world"
        style={{ transform: `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.scale})` }}
      >
        {/* 展开卡组容器（成员包围盒） */}
        {state.groups.filter((g) => !g.collapsed).map((group) => (
          <GroupView
            key={group.id}
            group={group}
            cardsById={api.cardsById}
            selected={api.selectedGroupIds.includes(group.id)}
            hiddenConnectionCount={0}
            onToggleCollapse={api.toggleGroupCollapsed}
            onDelete={api.deleteGroup}
            onRename={api.renameGroup}
            onChipPointerDown={onGroupPointerDown}
            onDropCard={api.addCardToGroup}
            onRemoveMember={(gid, cid) => api.removeCardsFromGroup(gid, [cid])}
            onReorderMember={api.reorderGroupMembers}
          />
        ))}

        <ConnectionLayer
          resolved={api.resolvedConnections}
          cardsById={api.cardsById}
          groupsById={api.groupsById}
          session={drag.session}
          selectedConnectionId={selectedConnectionId}
          onSelectConnection={setSelectedConnectionId}
        />

        {/* 可见卡片（折叠卡组的成员被隐藏，展开后恢复原位置与大小） */}
        {state.cards.filter((c) => !api.hiddenCardIds.has(c.id)).map((card) => (
          <CardView
            key={card.id}
            card={card}
            selected={api.selectedCardIds.includes(card.id)}
            connectMode={api.mode === 'connect'}
            grouped={api.membership.has(card.id)}
            onBodyPointerDown={onCardBodyPointerDown}
            onUpdate={api.updateCard}
            onDelete={(id) => api.deleteCards([id])}
            onStartConnect={(id, e) => drag.beginConnect(id, { x: e.clientX, y: e.clientY })}
          />
        ))}

        {/* 折叠卡组摘要容器（置于连线上方，端点吸附到其边界） */}
        {state.groups.filter((g) => g.collapsed).map((group) => (
          <GroupView
            key={group.id}
            group={group}
            cardsById={api.cardsById}
            selected={api.selectedGroupIds.includes(group.id)}
            hiddenConnectionCount={hiddenConnectionCountByGroup.get(group.id) ?? 0}
            onToggleCollapse={api.toggleGroupCollapsed}
            onDelete={api.deleteGroup}
            onRename={api.renameGroup}
            onChipPointerDown={onGroupPointerDown}
            onDropCard={api.addCardToGroup}
            onRemoveMember={(gid, cid) => api.removeCardsFromGroup(gid, [cid])}
            onReorderMember={api.reorderGroupMembers}
          />
        ))}

        {boxRect && <div className="box-select" style={{ left: boxRect.x, top: boxRect.y, width: boxRect.width, height: boxRect.height }} />}
      </div>

      {selectedConnection && (
        <div className="connection-editor" onPointerDown={(e) => e.stopPropagation()}>
          <div className="connection-editor__row">
            <button
              type="button"
              className={`mini-btn ${selectedConnection.type === 'arrow' ? 'mini-btn--active' : ''}`}
              onClick={() => connections.updateConnection(selectedConnection.id, { type: 'arrow' })}
            >
              箭头
            </button>
            <button
              type="button"
              className={`mini-btn ${selectedConnection.type === 'dashed' ? 'mini-btn--active' : ''}`}
              onClick={() => connections.updateConnection(selectedConnection.id, { type: 'dashed' })}
            >
              虚线
            </button>
            {CONNECTION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="palette__swatch"
                style={{ backgroundColor: color }}
                onClick={() => connections.updateConnection(selectedConnection.id, { color })}
              />
            ))}
          </div>
          <div className="connection-editor__row">
            <input
              className="connection-editor__label"
              value={selectedConnection.label}
              maxLength={LABEL_MAX_LENGTH}
              placeholder="标签（≤10字）"
              onChange={(e) => connections.updateConnection(selectedConnection.id, { label: e.target.value })}
            />
            <button
              type="button"
              className="mini-btn mini-btn--danger"
              onClick={() => {
                connections.deleteConnection(selectedConnection.id);
                setSelectedConnectionId(null);
              }}
            >
              删除连线
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
