import { useCallback, useMemo } from 'react';
import type { Card, Connection, ConnectionType } from '../types.ts';
import { topologicalOrder } from '../utils/topology.ts';
import type { CanvasApi } from './useCanvasState.ts';

/** 连线管理 + 叙事大纲（拓扑排序）。数据全部来自 useCanvasState 的统一 CanvasState */
export function useConnections(api: CanvasApi) {
  const { state, addConnection, updateConnection, deleteConnection } = api;

  const connectionsForCard = useCallback(
    (cardId: string): Connection[] =>
      state.connections.filter((c) => c.fromCardId === cardId || c.toCardId === cardId),
    [state.connections],
  );

  const createConnection = useCallback(
    (fromCardId: string, toCardId: string, type: ConnectionType = 'arrow', label = '') => {
      return addConnection(fromCardId, toCardId, type, label);
    },
    [addConnection],
  );

  const outline = useMemo<{ ordered: Card[]; cyclic: string[] }>(
    () => topologicalOrder(state),
    [state],
  );

  return {
    connections: state.connections,
    resolvedConnections: api.resolvedConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    connectionsForCard,
    outline,
    setOutlineOrder: api.setOutlineOrder,
  };
}
