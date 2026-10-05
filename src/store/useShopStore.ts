import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Adjudication, Book, Sale, ShopData, SlotMove } from '@/domain/types';
import {
  affectedBooksOfAdjudication,
  recompute,
  recomputeAffected,
  verifyConsistency,
  type EngineResult,
} from '@/domain/engine';
import { SAMPLE_DATA } from '@/domain/sampleData';

export const uid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface VerifyInfo {
  ok: boolean;
  at: string;
  affectedBooks: string[];
}

interface ShopState extends ShopData {
  result: EngineResult;
  lastVerify: VerifyInfo | null;
  addBook: (book: Omit<Book, 'id'>) => void;
  updateBook: (id: string, patch: Partial<Omit<Book, 'id'>>) => void;
  removeBook: (id: string) => void;
  addSale: (sale: Omit<Sale, 'id'>) => void;
  removeSale: (id: string) => void;
  addMove: (move: Omit<SlotMove, 'id'>) => void;
  removeMove: (id: string) => void;
  adjudicate: (slot: string, start: string, end: string, bookId: string) => void;
  removeAdjudication: (id: string) => void;
  recalculate: () => void;
  verify: () => boolean;
  loadSample: () => void;
  clearAll: () => void;
  exportData: () => string;
  importData: (json: string) => { ok: boolean; error?: string };
}

const emptyData = (): ShopData => ({ books: [], sales: [], moves: [], adjudications: [] });

function toIso(local: string): string {
  // datetime-local 输入（YYYY-MM-DDTHH:mm）直接可用；统一去掉秒
  return local.length > 16 ? local.slice(0, 16) : local;
}

function validateData(raw: unknown): ShopData {
  const d = raw as Partial<ShopData>;
  if (!d || typeof d !== 'object') throw new Error('数据不是有效的对象');
  for (const key of ['books', 'sales', 'moves', 'adjudications'] as const) {
    if (d[key] !== undefined && !Array.isArray(d[key])) {
      throw new Error(`字段 ${key} 应为数组`);
    }
  }
  const books = d.books ?? [];
  for (const b of books) {
    if (!b.id || !b.title) throw new Error('书籍缺少 id 或书名');
  }
  const bookIds = new Set(books.map((b) => b.id));
  const sales = d.sales ?? [];
  for (const s of sales) {
    if (!s.id || !s.time || !bookIds.has(s.bookId)) {
      throw new Error(`销售记录 ${s.id ?? '?'} 引用了不存在的书籍或缺少时刻`);
    }
  }
  return {
    books,
    sales,
    moves: d.moves ?? [],
    adjudications: d.adjudications ?? [],
  };
}

export const useShopStore = create<ShopState>()(
  persist(
    (set, get) => {
      // 普通数据变更：整体重算
      const mutate = (patch: Partial<ShopData>) => {
        set((state) => {
          const next: ShopData = {
            books: patch.books ?? state.books,
            sales: patch.sales ?? state.sales,
            moves: patch.moves ?? state.moves,
            adjudications: patch.adjudications ?? state.adjudications,
          };
          return { ...next, result: recompute(next), lastVerify: null };
        });
      };

      return {
        ...emptyData(),
        result: recompute(emptyData()),
        lastVerify: null,

        addBook: (book) =>
          mutate({ books: [...get().books, { ...book, id: uid() }] }),

        updateBook: (id, patch) =>
          mutate({
            books: get().books.map((b) => (b.id === id ? { ...b, ...patch } : b)),
          }),

        removeBook: (id) =>
          mutate({
            books: get().books.filter((b) => b.id !== id),
            sales: get().sales.filter((s) => s.bookId !== id),
            moves: get().moves.filter((m) => m.bookId !== id),
            adjudications: get().adjudications.filter((a) => a.bookId !== id),
          }),

        addSale: (sale) =>
          mutate({ sales: [...get().sales, { ...sale, time: toIso(sale.time), id: uid() }] }),

        removeSale: (id) => mutate({ sales: get().sales.filter((s) => s.id !== id) }),

        addMove: (move) =>
          mutate({
            moves: [...get().moves, { ...move, effectiveAt: toIso(move.effectiveAt), id: uid() }],
          }),

        removeMove: (id) => mutate({ moves: get().moves.filter((m) => m.id !== id) }),

        // 裁决：只增量重算受影响的书与时段，并自动与整体重算校验一致性
        adjudicate: (slot, start, end, bookId) => {
          const adj: Adjudication = { id: uid(), slot, start, end, bookId };
          const data: ShopData = {
            books: get().books,
            sales: get().sales,
            moves: get().moves,
            adjudications: [...get().adjudications, adj],
          };
          const affected = affectedBooksOfAdjudication(data, adj);
          const incremental = recomputeAffected(data, get().result, affected);
          const ok = verifyConsistency(data, incremental);
          set({
            adjudications: data.adjudications,
            result: incremental,
            lastVerify: {
              ok,
              at: new Date().toISOString(),
              affectedBooks: affected,
            },
          });
        },

        removeAdjudication: (id) =>
          mutate({ adjudications: get().adjudications.filter((a) => a.id !== id) }),

        recalculate: () => {
          const data: ShopData = {
            books: get().books,
            sales: get().sales,
            moves: get().moves,
            adjudications: get().adjudications,
          };
          set({ result: recompute(data) });
        },

        verify: () => {
          const data: ShopData = {
            books: get().books,
            sales: get().sales,
            moves: get().moves,
            adjudications: get().adjudications,
          };
          const ok = verifyConsistency(data, get().result);
          set({ lastVerify: { ok, at: new Date().toISOString(), affectedBooks: [] } });
          return ok;
        },

        loadSample: () => {
          const data = structuredClone(SAMPLE_DATA);
          set({ ...data, result: recompute(data), lastVerify: null });
        },

        clearAll: () => {
          const data = emptyData();
          set({ ...data, result: recompute(data), lastVerify: null });
        },

        exportData: () =>
          JSON.stringify(
            {
              books: get().books,
              sales: get().sales,
              moves: get().moves,
              adjudications: get().adjudications,
            },
            null,
            2,
          ),

        importData: (json) => {
          try {
            const data = validateData(JSON.parse(json));
            set({ ...data, result: recompute(data), lastVerify: null });
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      };
    },
    {
      name: 'song-bookshop-data',
      partialize: (state) => ({
        books: state.books,
        sales: state.sales,
        moves: state.moves,
        adjudications: state.adjudications,
      }),
      onRehydrateStorage: () => (state) => {
        state?.recalculate();
      },
    },
  ),
);
