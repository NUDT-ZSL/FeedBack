import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type {
  CanvasState,
  Card,
  CardGroup,
  Connection,
  ConnectionType,
  ToolMode,
} from '../types.ts';
import {
  CANVAS_STORAGE_VERSION,
  CARD_COLORS,
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  GROUP_COLORS,
  MIN_SCALE,
  MAX_SCALE,
} from '../types.ts';
import { emptyCanvasState, loadCanvasState, saveCanvasState, type LoadIssue } from '../utils/storage.ts';
import * as Groups from '../utils/groups.ts';
import { resolveAllConnections } from '../utils/groups.ts';
import { expandedGroupRect } from '../utils/geometry.ts';

export interface Warning {
  id: string;
  text: string;
  detail?: string;
}

function issueText(issue: LoadIssue): { text: string; detail?: string } {
  switch (issue.kind) {
    case 'membership-conflict':
      return {
        text: '卡片已属于其他卡组，重复归属已忽略',
        detail: `卡片保留在卡组 ${issue.conflict.keptGroupId}，未加入 ${issue.conflict.rejectedGroupId}`,
      };
    case 'dangling-connection':
      return { text: '检测到引用缺失卡片的连线', detail: `连线 ${issue.connectionId} 已保留待处理，未被静默删除` };
    case 'unknown-member':
      return { text: '卡组中存在引用缺失卡片的成员记录，已移除', detail: `卡组 ${issue.groupId} 的成员 ${issue.cardId}` };
  }
}

export function useCanvasState() {
  const [state, setState] = useState<CanvasState>(() => {
    const loaded = loadCanvasState();
    return loaded ? loaded.state : emptyCanvasState();
  });
  const [mode, setMode] = useState<ToolMode>('select');
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const pushWarning = useCallback((text: string, detail?: string) => {
    setWarnings((prev) => {
      if (prev.some((w) => w.text === text && w.detail === detail)) return prev;
      return [...prev.slice(-4), { id: uuidv4(), text, detail }];
    });
  }, []);
  const dismissWarning = useCallback((id: string) => {
    setWarnings((prev) => prev.filter((w) => w.id !== id));
  }, []);

  useEffect(() => {
    const loaded = loadCanvasState();
    if (loaded && loaded.issues.length > 0) {
      for (const issue of loaded.issues) {
        const { text, detail } = issueText(issue);
        pushWarning(text, detail);
      }
    }
    // 仅在首次挂载时报告存量数据问题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动持久化：折叠状态、卡组归属、成员顺序全部随画布状态保存
  useEffect(() => {
    saveCanvasState(stateRef.current);
  }, [state]);

  const patch = useCallback((fn: (prev: CanvasState) => CanvasState) => {
    setState((prev) => fn({ ...prev, version: CANVAS_STORAGE_VERSION }));
  }, []);

  // ---------- 视口 ----------
  const setViewport = useCallback(
    (offsetX: number, offsetY: number, scale: number) => {
      patch((prev) => ({ ...prev, offsetX, offsetY, scale }));
    },
    [patch],
  );
  const zoomBy = useCallback(
    (factor: number, center?: { x: number; y: number }) => {
      patch((prev) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
        let { offsetX, offsetY } = prev;
        if (center) {
          // 以鼠标位置为不动点缩放
          const wx = (center.x - prev.offsetX) / prev.scale;
          const wy = (center.y - prev.offsetY) / prev.scale;
          offsetX = center.x - wx * scale;
          offsetY = center.y - wy * scale;
        }
        return { ...prev, offsetX, offsetY, scale };
      });
    },
    [patch],
  );

  // ---------- 选择 ----------
  const selectCards = useCallback((ids: string[], additive = false) => {
    setSelectedCardIds((prev) => (additive ? Array.from(new Set([...prev, ...ids])) : ids));
    if (!additive) setSelectedGroupIds([]);
  }, []);
  const selectGroups = useCallback((ids: string[], additive = false) => {
    setSelectedGroupIds((prev) => (additive ? Array.from(new Set([...prev, ...ids])) : ids));
    if (!additive) setSelectedCardIds([]);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedCardIds([]);
    setSelectedGroupIds([]);
  }, []);

  // ---------- 卡片 ----------
  const addCard = useCallback(
    (x: number, y: number): Card => {
      const card: Card = {
        id: uuidv4(),
        title: '',
        content: '',
        color: CARD_COLORS[0],
        x: x - DEFAULT_CARD_WIDTH / 2,
        y: y - DEFAULT_CARD_HEIGHT / 2,
        width: DEFAULT_CARD_WIDTH,
        height: DEFAULT_CARD_HEIGHT,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      patch((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      setSelectedCardIds([card.id]);
      setSelectedGroupIds([]);
      return card;
    },
    [patch],
  );

  const updateCard = useCallback(
    (id: string, changes: Partial<Omit<Card, 'id' | 'createdAt'>>) => {
      patch((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, ...changes, updatedAt: Date.now() } : c)),
      }));
    },
    [patch],
  );

  const moveCards = useCallback(
    (deltas: Record<string, { dx: number; dy: number }>) => {
      patch((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => {
          const d = deltas[c.id];
          return d ? { ...c, x: c.x + d.dx, y: c.y + d.dy, updatedAt: Date.now() } : c;
        }),
      }));
    },
    [patch],
  );

  /** 拖拽过程中按绝对世界坐标回写卡片位置（保持卡组-成员相对关系完全不变） */
  const setCardPositions = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      patch((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          positions[c.id] ? { ...c, x: positions[c.id].x, y: positions[c.id].y, updatedAt: Date.now() } : c,
        ),
      }));
    },
    [patch],
  );

  const deleteCards = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      patch((prev) => ({
        ...prev,
        cards: prev.cards.filter((c) => !idSet.has(c.id)),
        connections: prev.connections.filter((c) => !idSet.has(c.fromCardId) && !idSet.has(c.toCardId)),
        groups: prev.groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((mid) => !idSet.has(mid)) })),
      }));
      setSelectedCardIds((prev) => prev.filter((id) => !idSet.has(id)));
    },
    [patch],
  );

  const recolorCards = useCallback(
    (ids: string[], color: string) => {
      const idSet = new Set(ids);
      patch((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (idSet.has(c.id) ? { ...c, color, updatedAt: Date.now() } : c)),
      }));
    },
    [patch],
  );

  const alignCardsToGrid = useCallback(
    (ids: string[], gridSize: number) => {
      const idSet = new Set(ids);
      patch((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          idSet.has(c.id)
            ? {
                ...c,
                x: Math.round(c.x / gridSize) * gridSize,
                y: Math.round(c.y / gridSize) * gridSize,
                updatedAt: Date.now(),
              }
            : c,
        ),
      }));
    },
    [patch],
  );

  // ---------- 连线 ----------
  const addConnection = useCallback(
    (fromCardId: string, toCardId: string, type: ConnectionType = 'arrow', label = ''): Connection | null => {
      if (fromCardId === toCardId) return null;
      let created: Connection | null = null;
      patch((prev) => {
        if (prev.connections.some((c) => c.fromCardId === fromCardId && c.toCardId === toCardId)) return prev;
        created = {
          id: uuidv4(),
          fromCardId,
          toCardId,
          type,
          color: '#aaaaaa',
          label,
        };
        return { ...prev, connections: [...prev.connections, created] };
      });
      return created;
    },
    [patch],
  );

  const updateConnection = useCallback(
    (id: string, changes: Partial<Omit<Connection, 'id'>>) => {
      patch((prev) => ({
        ...prev,
        connections: prev.connections.map((c) => (c.id === id ? { ...c, ...changes } : c)),
      }));
    },
    [patch],
  );

  const deleteConnection = useCallback(
    (id: string) => {
      patch((prev) => ({ ...prev, connections: prev.connections.filter((c) => c.id !== id) }));
    },
    [patch],
  );

  // ---------- 卡组 ----------
  const createGroupFromCards = useCallback(
    (cardIds: string[], name: string): CardGroup | null => {
      if (cardIds.length === 0) return null;
      const prev = stateRef.current;
      // 已经属于任意卡组的卡片不能直接进新组，先剔除并给出可观察反馈
      const membership = Groups.buildMembershipIndex(prev.groups);
      const free = cardIds.filter((id) => !membership.has(id));
      const occupied = cardIds.filter((id) => membership.has(id));
      if (occupied.length > 0) {
        pushWarning(
          `${occupied.length} 张卡片已属于其他卡组，未纳入新组`,
          `请先从原卡组移出后再建组`,
        );
      }
      if (free.length === 0) return null;
      const first = prev.cards.find((c) => c.id === free[0]);
      const group = Groups.createGroup(name, free, GROUP_COLORS[prev.groups.length % GROUP_COLORS.length], {
        x: first ? first.x : 0,
        y: first ? first.y - 40 : 0,
      });
      patch((p) => ({ ...p, groups: [...p.groups, group] }));
      setSelectedGroupIds([group.id]);
      setSelectedCardIds([]);
      return group;
    },
    [patch, pushWarning],
  );

  const addCardToGroup = useCallback(
    (groupId: string, cardId: string): boolean => {
      let accepted = false;
      patch((prev) => {
        const result = Groups.addCardToGroup(prev.groups, groupId, cardId);
        if (result.conflict) {
          const kept = prev.groups.find((g) => g.id === result.conflict!.keptGroupId);
          pushWarning('该卡片已属于另一个卡组，拖入被拒绝', `卡片保留在「${kept?.name ?? result.conflict.keptGroupId}」中（单卡单组）`);
          return prev;
        }
        accepted = true;
        return { ...prev, groups: result.groups };
      });
      return accepted;
    },
    [patch, pushWarning],
  );

  const removeCardsFromGroup = useCallback(
    (groupId: string, cardIds: string[]) => {
      const idSet = new Set(cardIds);
      patch((prev) => ({
        ...prev,
        groups: prev.groups.map((g) =>
          g.id === groupId ? { ...g, memberIds: g.memberIds.filter((id) => !idSet.has(id)) } : g,
        ),
      }));
    },
    [patch],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      patch((prev) => {
        const group = prev.groups.find((g) => g.id === groupId);
        if (group) {
          pushWarning(
            `卡组「${group.name}」已删除，${group.memberIds.length} 张成员卡片与相关连线均保留`,
            '连线未被删除：折叠吸附的端点在展开/重新建组后恢复为卡片端点',
          );
        }
        return { ...prev, groups: Groups.deleteGroup(prev.groups, groupId) };
      });
      setSelectedGroupIds((prev) => prev.filter((id) => id !== groupId));
    },
    [patch, pushWarning],
  );

  const toggleGroupCollapsed = useCallback(
    (groupId: string, collapsed?: boolean) => {
      patch((prev) => {
        const target = prev.groups.find((g) => g.id === groupId);
        const willCollapse = collapsed ?? !(target?.collapsed ?? false);
        let groups = Groups.toggleGroupCollapsed(prev.groups, groupId, collapsed);
        if (willCollapse && target && !target.collapsed) {
          // 折叠瞬间把摘要容器放到成员包围盒左上角，保证折叠前后视觉位置一致
          const rect = expandedGroupRect(target, new Map(prev.cards.map((c) => [c.id, c])));
          groups = Groups.moveGroupChip(groups, groupId, rect.x, rect.y);
        }
        return { ...prev, groups };
      });
    },
    [patch],
  );

  const renameGroup = useCallback(
    (groupId: string, name: string) => {
      patch((prev) => ({ ...prev, groups: Groups.renameGroup(prev.groups, groupId, name) }));
    },
    [patch],
  );

  const reorderGroupMembers = useCallback(
    (groupId: string, fromIndex: number, toIndex: number) => {
      patch((prev) => ({ ...prev, groups: Groups.reorderMembers(prev.groups, groupId, fromIndex, toIndex) }));
    },
    [patch],
  );

  const moveGroupChip = useCallback(
    (groupId: string, x: number, y: number) => {
      patch((prev) => ({ ...prev, groups: Groups.moveGroupChip(prev.groups, groupId, x, y) }));
    },
    [patch],
  );

  // ---------- 大纲顺序 ----------
  const setOutlineOrder = useCallback(
    (order: string[]) => {
      patch((prev) => ({ ...prev, outlineOrder: order }));
    },
    [patch],
  );

  const cardsById = useMemo(() => new Map(state.cards.map((c) => [c.id, c])), [state.cards]);
  const groupsById = useMemo(() => new Map(state.groups.map((g) => [g.id, g])), [state.groups]);
  const membership = useMemo(() => Groups.buildMembershipIndex(state.groups), [state.groups]);
  const hiddenCardIds = useMemo(
    () => new Set(state.groups.filter((g) => g.collapsed).flatMap((g) => g.memberIds)),
    [state.groups],
  );
  const resolvedConnections = useMemo(() => resolveAllConnections(state), [state]);

  return {
    state,
    mode,
    setMode,
    selectedCardIds,
    selectedGroupIds,
    selectCards,
    selectGroups,
    clearSelection,
    warnings,
    pushWarning,
    dismissWarning,
    setViewport,
    zoomBy,
    addCard,
    updateCard,
    moveCards,
    setCardPositions,
    deleteCards,
    recolorCards,
    alignCardsToGrid,
    addConnection,
    updateConnection,
    deleteConnection,
    createGroupFromCards,
    addCardToGroup,
    removeCardsFromGroup,
    deleteGroup,
    toggleGroupCollapsed,
    renameGroup,
    reorderGroupMembers,
    moveGroupChip,
    setOutlineOrder,
    cardsById,
    groupsById,
    membership,
    hiddenCardIds,
    resolvedConnections,
  };
}

export type CanvasApi = ReturnType<typeof useCanvasState>;
