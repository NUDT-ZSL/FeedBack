import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point, Rect } from '../types.ts';
import { normalizeRect } from '../utils/geometry.ts';

export type DragSession =
  | { kind: 'pan'; startClient: Point; startOffset: Point }
  | { kind: 'cards'; startClient: Point; origins: Map<string, Point>; moved: boolean }
  | { kind: 'groupChip'; groupId: string; startClient: Point; origin: Point; moved: boolean }
  | { kind: 'boxSelect'; startWorld: Point; currentWorld: Point }
  | { kind: 'connect'; fromCardId: string; currentWorld: Point };

export interface DragCallbacks {
  toWorld: (client: Point) => Point;
  onPan: (offsetX: number, offsetY: number) => void;
  /** 拖拽卡片时以绝对世界坐标回写（避免增量叠加误差） */
  onSetCardPositions: (positions: Record<string, Point>) => void;
  onMoveGroupChip: (groupId: string, x: number, y: number) => void;
  onBoxSelect: (rect: Rect, additive: boolean) => void;
  onConnect: (fromCardId: string, toCardId: string | null) => void;
  hitCard: (world: Point) => string | null;
}

/**
 * 统一拖拽会话：一次只进行一种拖拽（平移/卡片/卡组容器/框选/连线）。
 * 坐标换算：世界坐标 = (client - offset) / scale，缩放与平移只作用于视图层，
 * 不改变卡组与成员的相对关系（成员坐标本身不被缩放/平移修改）。
 */
export function useDrag(cb: DragCallbacks) {
  const [session, setSession] = useState<DragSession | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  sessionRef.current = session;
  const cbRef = useRef(cb);
  cbRef.current = cb;

  const beginPan = useCallback((client: Point, offset: Point) => {
    setSession({ kind: 'pan', startClient: client, startOffset: offset });
  }, []);

  const beginCards = useCallback((client: Point, origins: Map<string, Point>) => {
    setSession({ kind: 'cards', startClient: client, origins, moved: false });
  }, []);

  const beginGroupChip = useCallback((groupId: string, client: Point, origin: Point) => {
    setSession({ kind: 'groupChip', groupId, startClient: client, origin, moved: false });
  }, []);

  const beginBoxSelect = useCallback((client: Point) => {
    const world = cbRef.current.toWorld(client);
    setSession({ kind: 'boxSelect', startWorld: world, currentWorld: world });
  }, []);

  const beginConnect = useCallback((fromCardId: string, client: Point) => {
    const world = cbRef.current.toWorld(client);
    setSession({ kind: 'connect', fromCardId, currentWorld: world });
  }, []);

  useEffect(() => {
    if (!session) return;
    const onMove = (e: MouseEvent) => {
      const s = sessionRef.current;
      if (!s) return;
      const client = { x: e.clientX, y: e.clientY };
      if (s.kind === 'pan') {
        cbRef.current.onPan(
          s.startOffset.x + (client.x - s.startClient.x),
          s.startOffset.y + (client.y - s.startClient.y),
        );
      } else if (s.kind === 'cards') {
        const worldStart = cbRef.current.toWorld(s.startClient);
        const worldNow = cbRef.current.toWorld(client);
        const dx = worldNow.x - worldStart.x;
        const dy = worldNow.y - worldStart.y;
        const positions: Record<string, Point> = {};
        for (const [id, origin] of s.origins) {
          positions[id] = { x: origin.x + dx, y: origin.y + dy };
        }
        cbRef.current.onSetCardPositions(positions);
        if (!s.moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
          setSession({ ...s, moved: true });
        }
      } else if (s.kind === 'groupChip') {
        const worldStart = cbRef.current.toWorld(s.startClient);
        const worldNow = cbRef.current.toWorld(client);
        cbRef.current.onMoveGroupChip(
          s.groupId,
          s.origin.x + (worldNow.x - worldStart.x),
          s.origin.y + (worldNow.y - worldStart.y),
        );
        if (!s.moved) setSession({ ...s, moved: true });
      } else if (s.kind === 'boxSelect') {
        setSession({ ...s, currentWorld: cbRef.current.toWorld(client) });
      } else if (s.kind === 'connect') {
        setSession({ ...s, currentWorld: cbRef.current.toWorld(client) });
      }
    };
    const onUp = (e: MouseEvent) => {
      const s = sessionRef.current;
      setSession(null);
      if (!s) return;
      if (s.kind === 'boxSelect') {
        const rect = normalizeRect(s.startWorld, cbRef.current.toWorld({ x: e.clientX, y: e.clientY }));
        if (rect.width > 3 || rect.height > 3) {
          cbRef.current.onBoxSelect(rect, e.shiftKey);
        }
      } else if (s.kind === 'connect') {
        const target = cbRef.current.hitCard(cbRef.current.toWorld({ x: e.clientX, y: e.clientY }));
        cbRef.current.onConnect(s.fromCardId, target);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [session]);

  const cancel = useCallback(() => setSession(null), []);

  return { session, beginPan, beginCards, beginGroupChip, beginBoxSelect, beginConnect, cancel };
}
