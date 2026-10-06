import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CanvasState,
  Card,
  Connection,
  ConnectionType,
  GroupEvent,
  ToolMode,
} from '../types.ts';
import {
  CARD_COLORS,
  CONNECTION_COLORS,
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  MAX_SCALE,
  MIN_SCALE,
} from '../types.ts';
import {
  addCardToGroup,
  cloneState,
  createGroup,
  createId,
  deleteGroup,
  moveGroup,
  removeCardFromGroup,
  renameGroup,
  reorderMembers,
  setGroupCollapsed,
  syncGroupsAfterCardChange,
  type MutationResult,
} from '../engine/groups.ts';
import {
  emptyCanvasState,
  loadCanvasState,
  saveCanvasState,
} from '../engine/storage.ts';
import { runVerification, type VerifyReport } from '../engine/verify.ts';

export interface Toast {
  key: number;
  message: string;
  kind: 'group' | 'info' | 'warn';
}

export interface Selection {
  cardIds: string[];
  groupIds: string[];
  connectionId: string | null;
}

let toastKey = 0;

function loadInitial(): { state: CanvasState; warnings: string[] } {
  const result = loadCanvasState();
  if (result.ok && result.state) return { state: result.state, warnings: result.warnings };
  return { state: emptyCanvasState(), warnings: [] };
}

export function useBoardState() {
  const initialRef = useRef<{ state: CanvasState; warnings: string[] } | null>(null);
  if (initialRef.current === null) initialRef.current = loadInitial();

  const [canvas, setCanvas] = useState<CanvasState>(initialRef.current.state);
  const [tool, setTool] = useState<ToolMode>('select');
  const [connectType, setConnectType] = useState<ConnectionType>('arrow');
  const [pendingConnectFrom, setPendingConnectFrom] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ cardIds: [], groupIds: [], connectionId: null });
  const [toasts, setToasts] = useState<Toast[]>(() =>
    initialRef.current!.warnings.map((message) => ({ key: ++toastKey, message, kind: 'warn' as const })),
  );
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (saveCanvasState(canvas)) setLastSavedAt(Date.now());
  }, [canvas]);

  const pushToasts = useCallback((messages: Array<{ message: string; kind: Toast['kind'] }>) => {
    if (messages.length === 0) return;
    const added = messages.map((item) => ({ key: ++toastKey, ...item }));
    setToasts((prev) => [...prev, ...added]);
    for (const toast of added) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.key !== toast.key));
      }, 4500);
    }
  }, []);

  const pushEvents = useCallback(
    (events: GroupEvent[]) => {
      pushToasts(
        events.map((event) => ({
          message: event.message,
          kind: event.type === 'membership-conflict' ? ('warn' as const) : ('group' as const),
        })),
      );
    },
    [pushToasts],
  );

  const applyMutation = useCallback(
    (result: MutationResult) => {
      setCanvas(result.state);
      pushEvents(result.events);
    },
    [pushEvents],
  );

  const mutateCanvas = useCallback((fn: (draft: CanvasState) => void) => {
    setCanvas((prev) => {
      const next = cloneState(prev);
      fn(next);
      return next;
    });
  }, []);

  const addCard = useCallback(() => {
    mutateCanvas((draft) => {
      const now = Date.now();
      const centerX = (window.innerWidth / 2 - draft.offsetX) / draft.scale;
      const centerY = (window.innerHeight / 2 - draft.offsetY) / draft.scale;
      const card: Card = {
        id: createId(),
        title: '新卡片',
        content: '',
        color: CARD_COLORS[draft.cards.length % CARD_COLORS.length],
        x: centerX - DEFAULT_CARD_WIDTH / 2 + (draft.cards.length % 5) * 24,
        y: centerY - DEFAULT_CARD_HEIGHT / 2 + (draft.cards.length % 5) * 24,
        width: DEFAULT_CARD_WIDTH,
        height: DEFAULT_CARD_HEIGHT,
        createdAt: now,
        updatedAt: now,
      };
      draft.cards.push(card);
    });
  }, [mutateCanvas]);

  const updateCard = useCallback(
    (cardId: string, patch: Partial<Card>) => {
      mutateCanvas((draft) => {
        const card = draft.cards.find((item) => item.id === cardId);
        if (!card) return;
        Object.assign(card, patch, { updatedAt: Date.now() });
        syncGroupsAfterCardChange(draft);
      });
    },
    [mutateCanvas],
  );

  const moveCardsBy = useCallback(
    (cardIds: string[], dx: number, dy: number) => {
      if (cardIds.length === 0 || (dx === 0 && dy === 0)) return;
      mutateCanvas((draft) => {
        for (const card of draft.cards) {
          if (cardIds.includes(card.id)) {
            card.x += dx;
            card.y += dy;
            card.updatedAt = Date.now();
          }
        }
        syncGroupsAfterCardChange(draft);
      });
    },
    [mutateCanvas],
  );

  const moveGroupBy = useCallback((groupId: string, dx: number, dy: number) => {
    setCanvas((prev) => moveGroup(prev, groupId, dx, dy));
  }, []);

  const deleteSelection = useCallback(() => {
    const { cardIds, groupIds, connectionId } = selection;
    if (cardIds.length === 0 && groupIds.length === 0 && !connectionId) return;
    let removedCards = 0;
    let removedConnections = 0;
    const events: GroupEvent[] = [];
    setCanvas((prev) => {
      let draft = prev;
      for (const groupId of groupIds) {
        const result = deleteGroup(draft, groupId);
        draft = result.state;
        events.push(...result.events);
      }
      draft = cloneState(draft);
      const cardSet = new Set(cardIds);
      removedCards = draft.cards.filter((card) => cardSet.has(card.id)).length;
      const before = draft.connections.length;
      draft.cards = draft.cards.filter((card) => !cardSet.has(card.id));
      draft.connections = draft.connections.filter(
        (conn) =>
          conn.id !== connectionId && !cardSet.has(conn.fromCardId) && !cardSet.has(conn.toCardId),
      );
      removedConnections = before - draft.connections.length;
      for (const group of draft.groups) {
        group.memberIds = group.memberIds.filter((id) => !cardSet.has(id));
      }
      syncGroupsAfterCardChange(draft);
      return draft;
    });
    setSelection({ cardIds: [], groupIds: [], connectionId: null });
    const parts: string[] = [];
    if (groupIds.length > 0) parts.push(`${groupIds.length} 个卡组（成员与连线已保留）`);
    if (removedCards > 0) parts.push(`${removedCards} 张卡片`);
    if (removedConnections > 0) parts.push(`${removedConnections} 条连线`);
    if (parts.length > 0) events.push({ type: 'group-deleted', message: `已删除 ${parts.join('、')}` });
    pushEvents(events);
  }, [selection, pushEvents]);

  const addConnection = useCallback(
    (fromCardId: string, toCardId: string) => {
      if (fromCardId === toCardId) {
        pushToasts([{ message: '不能将卡片连接到自身', kind: 'warn' }]);
        return;
      }
      let duplicated = false;
      mutateCanvas((draft) => {
        duplicated = draft.connections.some(
          (conn) => conn.fromCardId === fromCardId && conn.toCardId === toCardId,
        );
        if (duplicated) return;
        const conn: Connection = {
          id: createId(),
          fromCardId,
          toCardId,
          type: connectType,
          color: CONNECTION_COLORS[0],
          label: '',
        };
        draft.connections.push(conn);
      });
      pushToasts([
        duplicated
          ? { message: '两张卡片之间已存在相同方向的连线', kind: 'warn' }
          : { message: `已创建${connectType === 'arrow' ? '箭头' : '虚线'}连线`, kind: 'info' },
      ]);
    },
    [connectType, mutateCanvas, pushToasts],
  );

  const updateConnection = useCallback(
    (connectionId: string, patch: Partial<Connection>) => {
      mutateCanvas((draft) => {
        const conn = draft.connections.find((item) => item.id === connectionId);
        if (conn) Object.assign(conn, patch);
      });
    },
    [mutateCanvas],
  );

  const setViewport = useCallback(
    (offsetX: number, offsetY: number, scale: number) => {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      setCanvas((prev) => ({ ...prev, offsetX, offsetY, scale: clamped }));
    },
    [],
  );

  const createGroupFromSelection = useCallback(() => {
    applyMutation(createGroup(canvas, selection.cardIds));
    setSelection({ cardIds: [], groupIds: [], connectionId: null });
  }, [canvas, selection.cardIds, applyMutation]);

  const runVerify = useCallback(() => {
    setVerifyReport(runVerification());
  }, []);

  return {
    canvas,
    tool,
    setTool,
    connectType,
    setConnectType,
    pendingConnectFrom,
    setPendingConnectFrom,
    selection,
    setSelection,
    toasts,
    verifyReport,
    setVerifyReport,
    lastSavedAt,
    addCard,
    updateCard,
    moveCardsBy,
    moveGroupBy,
    deleteSelection,
    addConnection,
    updateConnection,
    setViewport,
    createGroupFromSelection,
    runVerify,
    groupActions: {
      addCard: (groupId: string, cardId: string) => applyMutation(addCardToGroup(canvas, groupId, cardId)),
      removeCard: (groupId: string, cardId: string) => applyMutation(removeCardFromGroup(canvas, groupId, cardId)),
      reorder: (groupId: string, from: number, to: number) => applyMutation(reorderMembers(canvas, groupId, from, to)),
      rename: (groupId: string, name: string) => setCanvas(renameGroup(canvas, groupId, name).state),
      setCollapsed: (groupId: string, collapsed: boolean) => applyMutation(setGroupCollapsed(canvas, groupId, collapsed)),
      remove: (groupId: string) => applyMutation(deleteGroup(canvas, groupId)),
    },
  };
}

export type BoardApi = ReturnType<typeof useBoardState>;
