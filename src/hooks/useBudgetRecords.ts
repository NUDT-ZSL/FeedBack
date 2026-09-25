import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createStorageAdapter } from '../services/storage';
import { BudgetRecord, StorageAdapter, StorageType } from '../types';
import { getErrorMessage } from '../utils/errors';
import { logger } from '../utils/logger';

type MutationKind = 'add' | 'update' | 'delete';

const MUTATION_ERROR_MESSAGES: Record<MutationKind, string> = {
  add: '添加记录失败，请稍后重试。',
  update: '更新记录失败，请稍后重试。',
  delete: '删除记录失败，请稍后重试。',
};

const LOAD_ERROR_MESSAGE = '加载记录失败，请检查浏览器存储权限后重试。';

export interface BudgetRecordsState {
  records: BudgetRecord[];
  loading: boolean;
  loadError: string | null;
  mutationError: string | null;
  storageType: StorageType;
  refresh: () => Promise<void>;
  add: (record: BudgetRecord) => Promise<boolean>;
  update: (record: BudgetRecord) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  changeStorageType: (type: StorageType) => void;
  dismissMutationError: () => void;
}

export const useBudgetRecords = (): BudgetRecordsState => {
  const [records, setRecords] = useState<BudgetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [storageType, setStorageType] = useState<StorageType>('localStorage');

  const adapterRef = useRef<StorageAdapter>(createStorageAdapter('localStorage'));
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);

    const startTime = performance.now();
    try {
      const nextRecords = await adapterRef.current.getAll();
      if (requestId === requestIdRef.current) {
        setRecords(nextRecords);
      }
      logger.debug(
        `[App] 数据加载耗时: ${(performance.now() - startTime).toFixed(2)}ms, 记录数: ${nextRecords.length}`,
      );
    } catch (error) {
      logger.error('加载记录失败:', error);
      if (requestId === requestIdRef.current) {
        setLoadError(getErrorMessage(error, LOAD_ERROR_MESSAGE));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, storageType]);

  const mutate = useCallback(
    async (kind: MutationKind, action: () => Promise<void>): Promise<boolean> => {
      const startTime = performance.now();
      setMutationError(null);

      try {
        await action();
        await refresh();
        const label =
          kind === 'add' ? '添加' : kind === 'update' ? '更新' : '删除';
        logger.debug(
          `[App] ${label}记录+重载总耗时: ${(performance.now() - startTime).toFixed(2)}ms`,
        );
        return true;
      } catch (error) {
        logger.error(MUTATION_ERROR_MESSAGES[kind], error);
        setMutationError(MUTATION_ERROR_MESSAGES[kind]);
        return false;
      }
    },
    [refresh],
  );

  const add = useCallback(
    (record: BudgetRecord) =>
      mutate('add', () => adapterRef.current.add(record)),
    [mutate],
  );

  const update = useCallback(
    (record: BudgetRecord) =>
      mutate('update', () => adapterRef.current.update(record)),
    [mutate],
  );

  const remove = useCallback(
    (id: string) => mutate('delete', () => adapterRef.current.delete(id)),
    [mutate],
  );

  const changeStorageType = useCallback((type: StorageType) => {
    adapterRef.current = createStorageAdapter(type);
    setRecords([]);
    setLoadError(null);
    setMutationError(null);
    setStorageType(type);
    logger.info(`[App] 存储方式切换为: ${type}`);
  }, []);

  useEffect(() => {
    if (records.length === 0) return;

    const renderStartTime = performance.now();
    const frameId = requestAnimationFrame(() => {
      logger.debug(
        `[App] 渲染完成耗时: ${(performance.now() - renderStartTime).toFixed(2)}ms`,
      );
    });

    return () => cancelAnimationFrame(frameId);
  }, [records]);

  const dismissMutationError = useCallback(() => setMutationError(null), []);

  return useMemo(
    () => ({
      records,
      loading,
      loadError,
      mutationError,
      storageType,
      refresh,
      add,
      update,
      remove,
      changeStorageType,
      dismissMutationError,
    }),
    [
      records,
      loading,
      loadError,
      mutationError,
      storageType,
      refresh,
      add,
      update,
      remove,
      changeStorageType,
      dismissMutationError,
    ],
  );
};
